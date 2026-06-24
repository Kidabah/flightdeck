from __future__ import annotations

import io
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

from PIL import Image, ImageDraw, ImageFont


@dataclass
class LabelStatus:
    available: bool
    model: str = "QL-700"
    label_size: str = "DK-22212 62mm continuous"
    last_error: Optional[str] = None


class LabelPrinter:
    MODEL = "QL-700"
    LABEL_SIZE = "62"
    LABEL_WIDTH_PX = 696
    LABEL_HEIGHT_PX = 520
    VENDOR = "04f9"
    PRODUCT_PRINTER = "2042"
    PRODUCT_EDITOR_LITE = "2049"

    def __init__(self):
        self.last_error: Optional[str] = None

    def status(self) -> LabelStatus:
        self.last_error = None
        if not shutil.which("lsusb"):
            return self._status_pyusb()
        try:
            out = subprocess.check_output(["lsusb"], text=True)
        except Exception as exc:
            pyusb_status = self._status_pyusb()
            if pyusb_status.available or pyusb_status.last_error:
                return pyusb_status
            self.last_error = _friendly_usb_error(exc)
            return LabelStatus(False, last_error=self.last_error)
        printer_line = next((line for line in out.splitlines() if f"{self.VENDOR}:{self.PRODUCT_PRINTER}" in line), "")
        if printer_line:
            node = _usb_device_node(printer_line)
            if node and not os.access(node, os.R_OK | os.W_OK):
                return LabelStatus(False, last_error=f"QL-700 detected but USB permission denied for {node}")
            return LabelStatus(True)
        if f"{self.VENDOR}:{self.PRODUCT_EDITOR_LITE}" in out:
            return LabelStatus(False, last_error="QL-700 is in Editor Lite mass-storage mode; turn Editor Lite off on the printer")
        return LabelStatus(False, last_error="Brother QL-700 not detected")

    def _status_pyusb(self) -> LabelStatus:
        try:
            import usb.core
        except Exception as exc:
            self.last_error = f"PyUSB unavailable for QL-700 detection: {exc}"
            return LabelStatus(False, last_error=self.last_error)
        try:
            printer = usb.core.find(idVendor=int(self.VENDOR, 16), idProduct=int(self.PRODUCT_PRINTER, 16))
            if printer is not None:
                return LabelStatus(True)
            editor_lite = usb.core.find(idVendor=int(self.VENDOR, 16), idProduct=int(self.PRODUCT_EDITOR_LITE, 16))
            if editor_lite is not None:
                return LabelStatus(False, last_error="QL-700 is in Editor Lite mass-storage mode; turn Editor Lite off on the printer")
        except Exception as exc:
            self.last_error = _friendly_usb_error(exc)
            return LabelStatus(False, last_error=self.last_error)
        self.last_error = "Brother QL-700 not detected"
        return LabelStatus(False, last_error=self.last_error)

    def render_spool_label(self, spool: dict, base_url: str = "https://flightdeck.tail7de73e.ts.net") -> Image.Image:
        if _compact_ql700_label_enabled():
            return self.render_compact_spool_label(spool, base_url=base_url)
        img = Image.new("RGB", (self.LABEL_WIDTH_PX, 430), "white")
        draw = ImageDraw.Draw(img)
        prefs = spool.get("_label_preferences") or {}
        display_id = spool.get("display_id") or spool.get("id") or "-"
        include_brand = prefs.get("label_include_brand", "true") == "true"
        include_colour = prefs.get("label_include_colour", "true") == "true"
        include_location = prefs.get("label_include_location", "true") == "true"

        font_bold = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 46)
        font_body = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 32)
        font_small = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 21)
        font_badge = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 30)

        x = 46
        material = " ".join([spool.get("material") or "Material", spool.get("subtype") or ""]).strip()
        brand = spool.get("brand") or "-"
        color_name = spool.get("color_name") or "-"
        color_hex = (spool.get("color_hex") or "").upper()
        location_line = ""
        if not str(spool.get("location_printer_id") or "").strip():
            location = (
                spool.get("storage_location_name")
                or spool.get("storage_location")
                or "Storage"
            )
            location_line = f"Loc: {location}"
        draw.text((x, 42), _ellipsize(draw, material, font_bold, 420), fill="black", font=font_bold)
        draw.text((x, 116), _ellipsize(draw, brand if include_brand else "Flightdeck spool", font_body, 420), fill="black", font=font_body)
        draw.text((x, 168), _ellipsize(draw, color_name if include_colour else f"Spool #{display_id}", font_body, 300), fill="black", font=font_body)
        if color_hex and include_colour:
            draw.text((x, 210), color_hex, fill="black", font=font_badge)
        draw.text((x, 258), f"Spool #{display_id}", fill="black", font=font_badge)

        if location_line and include_location:
            draw.text((506, 42), "Loc:", fill="black", font=font_small)
            draw.text((506, 72), _ellipsize(draw, location_line[5:], font_body, 150), fill="black", font=font_body)

        added = str(spool.get("added_at") or "")[:10]
        try:
            added = datetime.fromisoformat(added).strftime("%d/%m/%y")
        except Exception:
            added = datetime.utcnow().strftime("%d/%m/%y")
        bottom = f"{round(float(spool.get('label_weight_g') or 0))}g label weight  |  {added}"
        draw.text((x, 372), bottom, fill="black", font=font_small)

        qr_base = (base_url or "https://flightdeck.tail7de73e.ts.net").rstrip("/")
        qr_url = f"{qr_base}/#/spool/{spool.get('id')}"
        qr = _qr_image(qr_url)
        if qr:
            img.paste(qr.resize((152, 152)), (506, 218))
        else:
            draw.rectangle((506, 218, 658, 370), outline="black")
            draw.text((558, 276), "QR", fill="black", font=font_body)
        return img

    def render_compact_spool_label(self, spool: dict, base_url: str = "https://flightdeck.tail7de73e.ts.net") -> Image.Image:
        img = Image.new("RGB", (self.LABEL_WIDTH_PX, 330), "white")
        draw = ImageDraw.Draw(img)
        prefs = spool.get("_label_preferences") or {}
        display_id = spool.get("display_id") or spool.get("id") or "-"
        include_brand = prefs.get("label_include_brand", "true") == "true"
        include_colour = prefs.get("label_include_colour", "true") == "true"
        include_location = prefs.get("label_include_location", "true") == "true"

        font_title = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 44)
        font_body = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 28)
        font_small = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 19)
        font_badge = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28)
        font_spool = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 108)

        x = 42
        material = " ".join([spool.get("material") or "Material", spool.get("subtype") or ""]).strip()
        brand = spool.get("brand") or "-"
        color_name = spool.get("color_name") or "-"
        color_hex = (spool.get("color_hex") or "").upper()
        location_line = ""
        if not str(spool.get("location_printer_id") or "").strip():
            location = (
                spool.get("storage_location_name")
                or spool.get("storage_location")
                or "Storage"
            )
            location_line = f"Loc: {location}"

        draw.text((x, 26), _ellipsize(draw, material, font_title, 405), fill="black", font=font_title)
        draw.text((x, 88), _ellipsize(draw, brand if include_brand else "Flightdeck spool", font_body, 390), fill="black", font=font_body)
        colour_line = color_name if include_colour else f"Spool #{display_id}"
        if color_hex and include_colour:
            colour_line = f"{colour_line}  {color_hex}"
        draw.text((x, 130), _ellipsize(draw, colour_line, font_body, 390), fill="black", font=font_body)
        draw.text((x, 178), _ellipsize(draw, f"#{display_id}", font_spool, 395), fill="black", font=font_spool)

        if location_line and include_location:
            draw.text((496, 28), "Loc:", fill="black", font=font_small)
            draw.text((496, 54), _ellipsize(draw, location_line[5:], font_body, 155), fill="black", font=font_body)

        added = str(spool.get("added_at") or "")[:10]
        try:
            added = datetime.fromisoformat(added).strftime("%d/%m/%y")
        except Exception:
            added = datetime.utcnow().strftime("%d/%m/%y")
        bottom = f"{round(float(spool.get('label_weight_g') or 0))}g label  |  {added}"
        draw.text((x, 296), bottom, fill="black", font=font_small)

        qr_base = (base_url or "https://flightdeck.tail7de73e.ts.net").rstrip("/")
        qr_url = f"{qr_base}/#/spool/{spool.get('id')}"
        qr = _qr_image(qr_url)
        if qr:
            img.paste(qr.resize((178, 178)), (496, 118))
        else:
            draw.rectangle((496, 118, 674, 296), outline="black")
            draw.text((562, 188), "QR", fill="black", font=font_body)
        return img

    def print_spool_label(self, spool: dict, base_url: str = "https://flightdeck.tail7de73e.ts.net") -> bool:
        status = self.status()
        if not status.available:
            self.last_error = status.last_error
            return False
        image = self.render_spool_label(spool, base_url=base_url)
        return self._print_image(image)

    def render_location_label(self, location: dict, base_url: str = "https://flightdeck.tail7de73e.ts.net") -> Image.Image:
        img = Image.new("RGB", (self.LABEL_WIDTH_PX, 330), "white")
        draw = ImageDraw.Draw(img)
        name = str(location.get("name") or "Rack").strip() or "Rack"
        notes = str(location.get("notes") or "").strip()

        font_title = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 78)
        font_body = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 28)
        font_small = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 20)
        font_badge = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 26)

        draw.text((38, 28), _ellipsize(draw, name, font_title, 430), fill="black", font=font_title)
        subtitle = notes or "Scan to open this rack in Flightdeck"
        draw.text((42, 130), _ellipsize(draw, subtitle, font_body, 410), fill="black", font=font_body)
        draw.rounded_rectangle((42, 220, 394, 276), radius=12, outline="black", width=3)
        draw.text((62, 232), "FLIGHTDECK RACK", fill="black", font=font_badge)
        draw.text((42, 294), datetime.utcnow().strftime("Printed %d/%m/%y"), fill="black", font=font_small)

        qr_base = (base_url or "https://flightdeck.tail7de73e.ts.net").rstrip("/")
        loc_id = location.get("id")
        qr_url = f"{qr_base}/#/spools?view=cabinet"
        if loc_id is not None:
            qr_url += f"&location={loc_id}"
        qr = _qr_image(qr_url)
        if qr:
            img.paste(qr.resize((210, 210)), (454, 64))
        else:
            draw.rectangle((454, 64, 664, 274), outline="black")
            draw.text((532, 148), "QR", fill="black", font=font_body)
        return img

    def print_location_label(self, location: dict, base_url: str = "https://flightdeck.tail7de73e.ts.net") -> bool:
        status = self.status()
        if not status.available:
            self.last_error = status.last_error
            return False
        image = self.render_location_label(location, base_url=base_url)
        return self._print_image(image)

    def _print_image(self, image: Image.Image) -> bool:
        try:
            from brother_ql.backends.helpers import send
            from brother_ql.conversion import convert
            from brother_ql.raster import BrotherQLRaster
        except Exception as exc:
            self.last_error = f"brother_ql unavailable: {exc}"
            return False

        try:
            qlr = BrotherQLRaster(self.MODEL)
            instructions = convert(qlr=qlr, images=[image], label=self.LABEL_SIZE, rotate="0", threshold=70.0, dither=False)
            send(instructions=instructions, printer_identifier="usb://0x04f9:0x2042", backend_identifier="pyusb", blocking=True)
            return True
        except Exception as exc:
            message = str(exc)
            if "Access denied" in message or "insufficient permissions" in message:
                message = "QL-700 USB permission denied; add the flightdeck user to lp or apply the Brother udev rule"
            elif "No backend available" in message:
                message = "QL-700 USB backend unavailable. On Windows, install a WinUSB/libusb driver for the QL-700 with Zadig, or connect the label printer to the Pi/NAS."
            self.last_error = message
            return False

    def print_test_label(self) -> bool:
        spool = {
            "id": "TEST",
            "material": "Flightdeck",
            "subtype": "Test",
            "brand": "QL-700",
            "color_hex": "#ef4444",
            "color_name": "Ready",
            "label_weight_g": 1000,
            "added_at": datetime.utcnow().date().isoformat(),
        }
        return self.print_spool_label(spool)


def _font(path: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [path]
    bold = "Bold" in path or "bold" in path
    candidates.extend([
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf",
    ])
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _ellipsize(draw: ImageDraw.ImageDraw, text: str, font, max_width: int) -> str:
    if draw.textlength(text, font=font) <= max_width:
        return text
    while text and draw.textlength(text + "...", font=font) > max_width:
        text = text[:-1]
    return text + "..."


def _luminance(hex_color: str) -> float:
    h = hex_color.replace("#", "")
    if len(h) < 6:
        return 0
    r, g, b = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return 0.299 * r + 0.587 * g + 0.114 * b


def _qr_image(url: str) -> Optional[Image.Image]:
    try:
        import qrcode
        qr = qrcode.QRCode(border=1, box_size=4)
        qr.add_data(url)
        qr.make(fit=True)
        return qr.make_image(fill_color="black", back_color="white").convert("RGB")
    except Exception:
        return None


def _usb_device_node(lsusb_line: str) -> Optional[str]:
    match = re.match(r"Bus\s+(\d+)\s+Device\s+(\d+):", lsusb_line)
    if not match:
        return None
    return f"/dev/bus/usb/{match.group(1)}/{match.group(2)}"


def _friendly_usb_error(exc: Exception) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    if getattr(exc, "winerror", None) == 2 or "The system cannot find the file specified" in message:
        return "USB detection tool not found. On Windows, QL-700 printing needs a WinUSB/libusb driver via Zadig, or connect the label printer to the Pi/NAS."
    if "No backend available" in message:
        return "QL-700 USB backend unavailable. On Windows, install a WinUSB/libusb driver for the QL-700 with Zadig, or connect the label printer to the Pi/NAS."
    if "Access denied" in message or "insufficient permissions" in message:
        return "QL-700 USB permission denied; add the flightdeck user to lp or apply the Brother udev rule"
    return message


def _compact_ql700_label_enabled() -> bool:
    return os.getenv("FLIGHTDECK_LABEL_COMPACT", "true").strip().lower() not in {"0", "false", "no", "off"}

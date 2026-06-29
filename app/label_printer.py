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
        # Spool labels stay full-size; rack/location labels use their own compact layout.
        img = Image.new("RGB", (self.LABEL_WIDTH_PX, 430), "white")
        draw = ImageDraw.Draw(img)
        prefs = spool.get("_label_preferences") or {}
        display_id = spool.get("display_id") or spool.get("id") or "-"
        include_brand = prefs.get("label_include_brand", "true") == "true"
        include_colour = prefs.get("label_include_colour", "true") == "true"
        include_location = prefs.get("label_include_location", "true") == "true"

        font_bold = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 42)
        font_body = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 28)
        font_small = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 21)
        number_text = str(display_id)

        x = 46
        material = " ".join([spool.get("material") or "Material", spool.get("subtype") or ""]).strip()
        brand = spool.get("brand") or "-"
        color_name = spool.get("color_name") or "-"
        color_hex = (spool.get("color_hex") or "").upper()
        location_line = _spool_label_location_text(spool)
        draw.text((x, 36), _ellipsize(draw, material, font_bold, 420), fill="black", font=font_bold)
        draw.text((x, 92), _ellipsize(draw, brand if include_brand else "Flightdeck spool", font_body, 420), fill="black", font=font_body)
        if include_colour:
            colour_line = color_name
            if color_hex:
                colour_line = f"{colour_line} {color_hex}"
            draw.text((x, 132), _ellipsize(draw, colour_line, font_body, 420), fill="black", font=font_body)

        box = (x, 188, x + 196, 368)
        draw.rounded_rectangle(box, radius=16, outline="black", width=4)
        font_number = _hero_number_font(draw, number_text, max_width=box[2] - box[0] - 28)
        _draw_text_centered_in_box(draw, number_text, box, font_number)

        if location_line and include_location:
            draw.text((506, 36), "Loc:", fill="black", font=font_small)
            loc_font = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 24)
            draw.text((506, 66), _ellipsize(draw, location_line, loc_font, 150), fill="black", font=loc_font)

        added = str(spool.get("added_at") or "")[:10]
        try:
            added = datetime.fromisoformat(added).strftime("%d/%m/%y")
        except Exception:
            added = datetime.utcnow().strftime("%d/%m/%y")
        bottom = f"{round(float(spool.get('label_weight_g') or 0))}g label  |  {added}"
        draw.text((x, 388), bottom, fill="black", font=font_small)

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
        """Short rack-position strip for a numbered cupboard slot."""
        img = Image.new("RGB", (self.LABEL_WIDTH_PX, 210), "white")
        draw = ImageDraw.Draw(img)
        prefs = spool.get("_label_preferences") or {}
        display_id = spool.get("display_id") or spool.get("id") or "-"
        include_brand = prefs.get("label_include_brand", "true") == "true"
        include_colour = prefs.get("label_include_colour", "true") == "true"
        include_location = prefs.get("label_include_location", "true") == "true"

        font_number = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 86)
        font_title = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 30)
        font_body = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 24)
        font_small = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 17)
        font_badge = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)

        x = 28
        material = " ".join([spool.get("material") or "Material", spool.get("subtype") or ""]).strip()
        brand = spool.get("brand") or "-"
        color_name = spool.get("color_name") or "-"
        color_hex = (spool.get("color_hex") or "").upper()
        location_line = _rack_spool_label_location_text(spool)

        draw.rounded_rectangle((x, 26, 178, 178), radius=14, outline="black", width=3)
        number_text = f"{display_id}"
        bbox = draw.textbbox((0, 0), number_text, font=font_number)
        draw.text((x + (150 - (bbox[2] - bbox[0])) / 2, 54), number_text, fill="black", font=font_number)

        info_x = 202
        info_width = 280
        draw.text((info_x, 24), _ellipsize(draw, material, font_title, info_width), fill="black", font=font_title)
        draw.text((info_x, 68), _ellipsize(draw, brand if include_brand else "Flightdeck spool", font_body, info_width), fill="black", font=font_body)
        colour_line = color_name if include_colour else f"Spool #{display_id}"
        if color_hex and include_colour:
            colour_line = f"{colour_line}  {color_hex}"
        draw.text((info_x, 102), _ellipsize(draw, colour_line, font_body, info_width), fill="black", font=font_body)

        if location_line and include_location:
            draw.rounded_rectangle((info_x, 142, info_x + info_width, 176), radius=8, outline="black", width=2)
            draw.text((info_x + 12, 147), _ellipsize(draw, location_line, font_badge, info_width - 24), fill="black", font=font_badge)

        added = str(spool.get("added_at") or "")[:10]
        try:
            added = datetime.fromisoformat(added).strftime("%d/%m/%y")
        except Exception:
            added = datetime.utcnow().strftime("%d/%m/%y")
        bottom = f"{round(float(spool.get('label_weight_g') or 0))}g label | {added}"
        draw.text((x, 184), _ellipsize(draw, bottom, font_small, 455), fill="black", font=font_small)

        qr_base = (base_url or "https://flightdeck.tail7de73e.ts.net").rstrip("/")
        qr_url = f"{qr_base}/#/spool/{spool.get('id')}"
        qr = _qr_image(qr_url)
        if qr:
            img.paste(qr.resize((160, 160)), (512, 26))
        else:
            draw.rectangle((512, 26, 672, 186), outline="black")
            draw.text((570, 92), "QR", fill="black", font=font_body)
        return img

    def print_spool_label(self, spool: dict, base_url: str = "https://flightdeck.tail7de73e.ts.net") -> bool:
        status = self.status()
        if not status.available:
            self.last_error = status.last_error
            return False
        image = self.render_spool_label(spool, base_url=base_url)
        return self._print_image(image)

    def print_compact_spool_label(self, spool: dict, base_url: str = "https://flightdeck.tail7de73e.ts.net") -> bool:
        status = self.status()
        if not status.available:
            self.last_error = status.last_error
            return False
        image = self.render_compact_spool_label(spool, base_url=base_url)
        return self._print_image(image)

    def render_location_label(self, location: dict, base_url: str = "https://flightdeck.tail7de73e.ts.net") -> Image.Image:
        img = Image.new("RGB", (self.LABEL_WIDTH_PX, 190), "white")
        draw = ImageDraw.Draw(img)
        name = str(location.get("name") or "Rack").strip() or "Rack"
        notes = str(location.get("notes") or "").strip()
        rack_range, rack_direction = _rack_label_parts(name, notes)
        title = f"Rack {rack_range}" if rack_range else name
        row_name = re.sub(r"\s*[·-]\s*\d+\s*-\s*\d+\s*$", "", name).strip() or "Rack"

        font_title = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 48)
        font_row = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
        font_body = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 20)
        font_small = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 16)
        font_badge = _font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)

        draw.text((34, 20), _ellipsize(draw, title, font_title, 430), fill="black", font=font_title)
        draw.text((36, 78), _ellipsize(draw, row_name, font_row, 430), fill="black", font=font_row)
        subtitle = rack_direction or notes or "Scan to open this rack in Flightdeck"
        draw.text((36, 108), _ellipsize(draw, subtitle, font_body, 430), fill="black", font=font_body)
        draw.rounded_rectangle((36, 140, 250, 173), radius=8, outline="black", width=2)
        draw.text((48, 147), "FLIGHTDECK RACK", fill="black", font=font_badge)
        draw.text((276, 149), datetime.utcnow().strftime("%d/%m/%y"), fill="black", font=font_small)

        qr_base = (base_url or "https://flightdeck.tail7de73e.ts.net").rstrip("/")
        loc_id = location.get("id")
        qr_url = f"{qr_base}/#/spools?view=cabinet"
        if loc_id is not None:
            qr_url += f"&location={loc_id}"
        qr = _qr_image(qr_url)
        if qr:
            img.paste(qr.resize((150, 150)), (512, 20))
        else:
            draw.rectangle((512, 20, 662, 170), outline="black")
            draw.text((568, 84), "QR", fill="black", font=font_body)
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


def _hero_number_font(draw: ImageDraw.ImageDraw, number_text: str, *, max_width: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    bold_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    for size in (156, 140, 124, 108, 92, 78):
        font = _font(bold_path, size)
        if draw.textlength(number_text, font=font) <= max_width:
            return font
    return _font(bold_path, 78)


def _draw_text_centered_in_box(
    draw: ImageDraw.ImageDraw,
    text: str,
    box: tuple[int, int, int, int],
    font,
) -> None:
    left, top, right, bottom = box
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]
    x = left + ((right - left) - text_w) / 2 - bbox[0]
    y = top + ((bottom - top) - text_h) / 2 - bbox[1]
    draw.text((x, y), text, fill="black", font=font)


def _luminance(hex_color: str) -> float:
    h = hex_color.replace("#", "")
    if len(h) < 6:
        return 0
    r, g, b = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return 0.299 * r + 0.587 * g + 0.114 * b


def _rack_label_parts(name: str, notes: str) -> tuple[Optional[str], Optional[str]]:
    text = f"{name} {notes}"
    range_match = re.search(r"(?<![\d-])(\d+\s*-\s*\d+)(?!\s*-)", text)
    direction_match = re.search(r"\b(left\s+to\s+right|right\s+to\s+left)\b", text, re.IGNORECASE)
    rack_range = range_match.group(1).replace(" ", "") if range_match else None
    direction = direction_match.group(1).lower() if direction_match else None
    return rack_range, direction


def _spool_label_location_text(spool: dict) -> str:
    """Plain home/storage location for full spool stickers."""
    loaded = bool(str(spool.get("location_printer_id") or "").strip())
    current_location = spool.get("storage_location_name") or spool.get("storage_location")
    home_location = spool.get("home_storage_location_name") or spool.get("home_storage_location")
    location = (home_location or current_location or "Storage") if loaded else (current_location or home_location or "Storage")
    return str(location).strip() or "Storage"


def _rack_spool_label_location_text(spool: dict) -> str:
    """Rack row marker for compact slot stickers beside the physical rack."""
    for key in ("storage_location_name", "storage_location", "home_storage_location_name", "home_storage_location"):
        text = str(spool.get(key) or "").strip()
        if text and re.search(r"rack\s*row", text, re.IGNORECASE):
            return text
    try:
        num = int(spool.get("display_id") or spool.get("id") or 0)
    except (TypeError, ValueError):
        num = 0
    if num > 0:
        row = (num - 1) // 10 + 1
        start = (row - 1) * 10 + 1
        end = start + 9
        return f"Rack Row {row} · {start}-{end}"
    return _spool_label_location_text(spool)


def _compact_location_name(name: str) -> str:
    text = str(name or "").strip()
    if not text:
        return "Storage"
    range_match = re.search(r"(?<![\d-])(\d+\s*-\s*\d+)(?!\s*-)", text)
    if range_match:
        return f"Rack {range_match.group(1).replace(' ', '')}"
    return text


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

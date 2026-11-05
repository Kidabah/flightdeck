"""Bambu FTP: refused sessions get a readable message and sockets always close."""
from __future__ import annotations

import ftplib
import socket
import threading

from app.printers import bambu_ftp


def _plaintext_refusing_server():
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)

    def serve():
        conn, _ = srv.accept()
        conn.settimeout(5)
        try:
            conn.recv(4096)  # wait for the client's TLS hello, then answer in plain text
            conn.sendall(b"421 There are too many connections from your internet address.\r\n")
            while conn.recv(4096):  # stay open until the client gives up, like the printer
                pass
        except OSError:
            pass
        conn.close()
        srv.close()

    threading.Thread(target=serve, daemon=True).start()
    return srv.getsockname()[1]


def test_too_many_connections_is_readable():
    port = _plaintext_refusing_server()
    ftp = bambu_ftp._ImplicitFTP_TLS()
    try:
        ftp.connect("127.0.0.1", port, timeout=5)
    except ftplib.error_temp as exc:
        assert "too many open file connections" in str(exc)
        assert "WRONG_VERSION" not in str(exc)
    else:
        raise AssertionError("expected the refused session to raise")


def test_friendly_error_maps_421():
    msg = bambu_ftp.friendly_bambu_ftp_error(Exception("[SSL: WRONG_VERSION_NUMBER] wrong version number"))
    assert msg == bambu_ftp.TOO_MANY_CONNECTIONS_MESSAGE


def test_close_ftp_closes_even_when_quit_fails():
    closed = []

    class Fake:
        sock = None

        def quit(self):
            raise OSError("printer went quiet")

        def close(self):
            closed.append(True)

    bambu_ftp._close_ftp(Fake())
    assert closed == [True]

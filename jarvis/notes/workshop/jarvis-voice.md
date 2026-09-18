# Jarvis finish window

The microphone finish window is **900 milliseconds** (`FINISH_MS`). Speech recognition finalizes phrases on pause; Jarvis buffers and only sends after a true end-of-thought pause. Short interrupt words **stop** and **wait** bypass the buffer.

Tune FINISH_MS after a day of real use — too low cuts you off, too high feels sluggish.

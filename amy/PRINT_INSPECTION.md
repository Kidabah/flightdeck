# Amy print inspection

Open **PRINT CHECK** beside Amy, choose a printer and press **Check camera**.
The image is sent to Amy's configured AI service for a visual assessment.
The panel shows the actual image, retrieval time, freshness evidence and observations.

You can also say:

- “Amy, check BigBoy's first layer.”
- “Have a look at Big Girl's print.”
- “Inspect Little Boy's camera.”
- “What looks wrong with this print?” (takes another image of the printer displayed in this viewer).
- “Save that to the windmill project.”
- “Save that to my current project.”

**Save image & observations to current project** files the exact displayed image and assessment.
Saved inspections appear below that project's notes. Opening one labels it as past evidence.
Saving the same inspection again does not duplicate its note. Each viewer tracks its own displayed
inspection; Amy does not guess another viewer's latest image when asked to “save that”.

For Flightdeck's shared camera feeds, Amy confirms that the frame sequence advances before fetching
the inspection image. Stalled feeds, simulated cameras and unavailable-camera placeholders are
rejected. Direct camera snapshots without health metadata are labelled with an unknown capture time.
Retrieval time is not a promise that every camera supplies an exact exposure timestamp.

The assessment separates visible evidence, possible concerns, uncertainty and the next check.
A distant or blocked camera cannot prove first-layer adhesion, dimensions or hidden defects.
No printer control, calibration, pause, cancellation or setting changes are performed by inspection.
This is an on-demand check, not unattended failure monitoring.

Images and assessments are stored in the existing config-adjacent `companion.sqlite3` notebook.
Unsaved previews expire after 24 hours or ten newer checks; saved project evidence is retained.
Desktop and Pi notebooks remain independent. Image/model failures are shown explicitly; an image
with a failed assessment is not represented as a print-quality diagnosis.

Verification for the initial installation: live snapshots and advancing feeds from all three
configured printers; mocked-model browser workflow; Python/HTTP regression tests. Sending a real
frame to the configured AI service remains pending explicit approval after automatic approval
review rejected that test. Microphone transcription and audible playback were not retested.

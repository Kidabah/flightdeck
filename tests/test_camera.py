import unittest

from app.camera import _STREAM_FPS_VALUE, _STREAM_POLL_INTERVAL, _camera_ffmpeg_args, _frame_signature


class CameraFfmpegArgsTests(unittest.TestCase):
    def test_frame_rate_filter_runs_before_scaling(self) -> None:
        args = _camera_ffmpeg_args("rtsps://example.invalid/stream")

        filter_value = args[args.index("-vf") + 1]

        self.assertEqual(filter_value, "fps=12,scale=960:-2")
        self.assertNotIn("-r", args)

    def test_stream_polling_can_observe_every_target_frame(self) -> None:
        self.assertEqual(_STREAM_FPS_VALUE, 12)
        self.assertLessEqual(_STREAM_POLL_INTERVAL, 1 / _STREAM_FPS_VALUE)

    def test_camera_work_is_capped_to_one_thread_per_stage(self) -> None:
        args = _camera_ffmpeg_args("rtsps://example.invalid/stream")

        thread_positions = [index for index, arg in enumerate(args) if arg == "-threads"]

        self.assertEqual(len(thread_positions), 2)
        self.assertTrue(all(args[index + 1] == "1" for index in thread_positions))
        self.assertEqual(args[args.index("-filter_threads") + 1], "1")

    def test_frame_signature_detects_interior_change(self) -> None:
        prefix = b"\xff\xd8" + (b"header" * 12)
        suffix = (b"tail" * 20) + b"\xff\xd9"
        first = prefix + (b"A" * 256) + suffix
        second = prefix + (b"B" * 256) + suffix

        self.assertEqual(len(first), len(second))
        self.assertEqual(first[32:64], second[32:64])
        self.assertEqual(first[-64:], second[-64:])
        self.assertNotEqual(_frame_signature(first), _frame_signature(second))


if __name__ == "__main__":
    unittest.main()

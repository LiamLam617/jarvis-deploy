import unittest

from bridge_protocol import fixed_result, sign_headers, verify_headers


class InternalSignatureTests(unittest.TestCase):
    def test_signature_binds_path_body_and_timestamp(self):
        secret = "test-only-high-entropy-secret"
        body = b'{"schema_version":1,"event_id":"12345678901234567"}'
        headers = sign_headers(secret, "/dispatch", body, timestamp=1_800_000_000)

        self.assertTrue(verify_headers(secret, "/dispatch", body, headers, now=1_800_000_000))
        self.assertFalse(verify_headers(secret, "/claim", body, headers, now=1_800_000_000))
        self.assertFalse(verify_headers(secret, "/dispatch", body + b" ", headers, now=1_800_000_000))

    def test_signature_rejects_stale_and_malformed_headers(self):
        secret = "test-only-high-entropy-secret"
        body = b"{}"
        headers = sign_headers(secret, "/dispatch", body, timestamp=1_800_000_000)

        self.assertFalse(verify_headers(secret, "/dispatch", body, headers, now=1_800_000_301))
        self.assertFalse(verify_headers(secret, "/dispatch", body, {**headers, "x-jarvis-signature": "bad"}, now=1_800_000_000))


class FixedResultTests(unittest.TestCase):
    def test_only_p04_commands_have_fixed_results(self):
        self.assertIn("尚未保存", fixed_result("capture"))
        self.assertIn("Hermes 尚未接入", fixed_result("jarvis"))
        with self.assertRaisesRegex(ValueError, "UNSUPPORTED_P04_COMMAND"):
            fixed_result("status")


if __name__ == "__main__":
    unittest.main()

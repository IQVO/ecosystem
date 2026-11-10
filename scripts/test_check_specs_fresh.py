#!/usr/bin/env python3
"""check-specs-fresh.py with an injected fetcher: no gh, no network."""
import importlib.util, os, tempfile, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("csf", os.path.join(HERE, "check-specs-fresh.py"))
csf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(csf)


def tree(files):
    root = tempfile.mkdtemp()
    for rel, text in files.items():
        p = os.path.join(root, "specs", rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "w").write(text)
    return root


class Gate(unittest.TestCase):
    def run_gate(self, files, remote):
        def fake(org, ctx, name):
            if (ctx, name) not in remote:
                raise RuntimeError(f"{ctx} {name}: 404")
            return remote[(ctx, name)]
        csf.fetch = fake
        return csf.main(["--root", tree(files)])

    def test_equal_copies_pass(self):
        self.assertEqual(self.run_gate({"a/openapi.yaml": "x\n"}, {("a", "openapi.yaml"): "x\n"}), 0)

    def test_a_stale_copy_fails(self):
        self.assertEqual(self.run_gate({"a/openapi.yaml": "purchaseOrders\n"}, {("a", "openapi.yaml"): "items\n"}), 1)

    def test_an_unreadable_producer_is_not_a_pass(self):
        self.assertEqual(self.run_gate({"a/openapi.yaml": "x\n"}, {}), 2)

    def test_nothing_to_check_is_not_a_pass(self):
        self.assertEqual(self.run_gate({"a/README.md": "x\n"}, {}), 3)


if __name__ == "__main__":
    unittest.main()

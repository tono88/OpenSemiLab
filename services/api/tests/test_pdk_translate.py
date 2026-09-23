import gzip
import json
from pathlib import Path

from opensemilab_api.pdk_translate import translate_commercial_references


def test_translates_synthetic_vendor_references_without_claiming_signoff(tmp_path: Path):
    source = tmp_path / "source" / "1p5m_1tm_9k"
    source.mkdir(parents=True)
    (source / "stream.map").write_text(
        "D 10:0 10 0 ; METAL1\nD 11:0 11 0 ; VIA1\nD 12:0 12 0 ; METAL2\n",
        encoding="utf-8",
    )
    (source / "lvs.cal").write_text(
        "LAYER MAP 10 DATATYPE 0 10\nLAYER METAL1 10\n"
        "LAYER MAP 11 DATATYPE 0 11\nLAYER VIA1 11\n"
        "LAYER MAP 12 DATATYPE 0 12\nLAYER METAL2 12\n"
        "CONNECT METAL1 VIA1\nCONNECT VIA1 METAL2\nDEVICE MOS4\n",
        encoding="utf-8",
    )
    tlu = (
        "DIELECTRIC OXIDE { THICKNESS=1.0 ER=3.9 }\n"
        "CONDUCTOR METAL1 { THICKNESS=0.5 WMIN=0.2 SMIN=0.2 RPSQ=0.1 }\n"
        "VIA VIA1 { FROM=METAL1 TO=METAL2 AREA=0.04 RPV=2.0 }\n"
        "#### end_ascii_header\n"
    ).encode() + b"\x00\x01synthetic-binary-table"
    (source / "typical.tluplus").write_bytes(gzip.compress(tlu))
    (source / "corner.rules.R").write_bytes(b"#DECRYPT\nsynthetic-encrypted-payload")

    output = tmp_path / "translated"
    summary = translate_commercial_references(tmp_path / "source", output, "1P5M_1TM_9K")

    assert summary == {
        "status": "draft_requires_validation",
        "layer_count": 3,
        "lvs_connection_count": 2,
        "lvs_device_family_count": 1,
        "rc_corner_count": 1,
        "encrypted_file_count": 1,
        "artifact_count": 7,
        "requires_validation": True,
    }
    assert (output / "klayout" / "technology.lyt").is_file()
    assert (output / "klayout" / "layers.lyp").is_file()
    assert "connect(metal1, via1)" in (output / "klayout" / "lvs_draft.lylvs").read_text()
    assert (output / "openrcx" / "materials-typical.json").is_file()
    assert not (output / "openrcx" / "rcx_patterns.rules").exists()
    report = json.loads((output / "translation-report.json").read_text())
    assert report["status"] == "draft_requires_validation"
    assert "openrcx_calibration" in report["requires_validation"]
    assert "lvs.cal" not in json.dumps(summary)


def test_generates_milkyway_export_instructions_but_not_fake_gds(tmp_path: Path):
    source = tmp_path / "source" / "milkyway"
    source.mkdir(parents=True)
    (source / "library_marker").write_text("synthetic", encoding="utf-8")
    output = tmp_path / "translated"

    summary = translate_commercial_references(tmp_path / "source", output, None)

    assert summary["artifact_count"] == 4
    assert (output / "commercial-export" / "M31_GDS_EXPORT_REQUIRED.md").is_file()
    assert (output / "commercial-export" / "M31_CDL_REQUIRED.md").is_file()
    assert not list(output.rglob("*.gds"))
    assert not list(output.rglob("*.cdl"))

"""Independent PDF export check: python scripts/verify-vector-pdf.py file.pdf.

Requires pypdf in the test environment. This is deliberately outside npm test:
the packaged application has no Python dependency.
"""

import argparse
from pypdf import PdfReader


def verify(path: str, width_mm: float, height_mm: float, expected_text: str) -> None:
    reader = PdfReader(path)
    assert len(reader.pages) == 1, "expected a single sheet"
    page = reader.pages[0]
    width_pt = float(page.mediabox.width)
    height_pt = float(page.mediabox.height)
    assert abs(width_pt - width_mm * 72 / 25.4) < 0.01, (width_pt, width_mm)
    assert abs(height_pt - height_mm * 72 / 25.4) < 0.01, (height_pt, height_mm)
    text = page.extract_text()
    assert expected_text in text, f"Unicode text is not selectable: {ascii(text[:200])}"
    resources = page["/Resources"]
    for reference in resources.get("/XObject", {}).values():
        assert reference.get_object().get("/Subtype") != "/Image", "raster page image found"
    fonts = [reference.get_object() for reference in resources["/Font"].values()]
    drafting_fonts = [font for font in fonts if "NAPS Drafting" in str(font.get("/BaseFont", ""))]
    assert drafting_fonts, "drafting font not registered"
    for font in drafting_fonts:
        assert font.get("/ToUnicode"), "font has no Unicode character map"
        descendant = font["/DescendantFonts"][0].get_object()
        descriptor = descendant["/FontDescriptor"].get_object()
        assert any(key in descriptor for key in ("/FontFile", "/FontFile2", "/FontFile3")), "font not embedded"
    print(f"PDF verified: {width_mm:g} x {height_mm:g} mm, vector, embedded font, selectable {ascii(expected_text)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf")
    parser.add_argument("--width-mm", type=float, default=297)
    parser.add_argument("--height-mm", type=float, default=210)
    parser.add_argument("--text", default="Разраб.")
    options = parser.parse_args()
    verify(options.pdf, options.width_mm, options.height_mm, options.text)

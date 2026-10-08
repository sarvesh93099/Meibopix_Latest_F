# Meibography sample images

These two real, non-contact infrared meibography images are bundled to let visitors try the image upload, eyelid selection, and gland-marking workflow without supplying their own photograph.

| Local file | Original archive member | Lid | Resolution | File size |
| --- | --- | --- | --- | --- |
| `repod-05-lower-eyelid.png` | `05_DED_Lower.BMP` | Lower | 1360 × 1024 | 523,878 bytes |
| `repod-05-upper-eyelid.png` | `05_DED_Upper.BMP` | Upper | 1360 × 1024 | 496,697 bytes |

Both images come from the same research participant. Eye laterality is not specified by these filenames and is deliberately left unset in the manifest. The dataset's group code does not supply a gland-loss score; the application should not assign a diagnosis or a known dropout percentage to these samples.

## Source and attribution

Izabela Garaszczuk and Karolina Jarosz (2025), *Dry eye disease diagnosis based on criteria recommended in Dry Eye Workshop II report*, RepOD, version 1.0. DOI: [10.18150/TT8JVD](https://doi.org/10.18150/TT8JVD).

- [Dataset and description](https://repod.icm.edu.pl/dataset.xhtml?persistentId=doi:10.18150/TT8JVD)
- [Original Meibography.zip file and its license](https://repod.icm.edu.pl/file.xhtml?fileId=62889&version=1.0)
- [Dataset naming guide](https://repod.icm.edu.pl/file.xhtml?fileId=65299&version=1.0)
- [Creative Commons Attribution 4.0 International license](https://creativecommons.org/licenses/by/4.0/)

The source identifies these as upper and lower everted eyelid images captured using an Oculus Keratograph 5M. The repository explicitly marks the dataset and the Meibography.zip file as **CC BY 4.0**, which allows redistribution with attribution. The original text naming guide also mentions CC0; this project follows the repository's file-specific CC BY 4.0 designation and retains full attribution.

Retrieved and license checked on **2026-10-06**. Keep the attribution, source link, and license available when displaying or redistributing these files. The sample images are licensed separately from the application's source code.

## Resource use and conversion

Only the first two relevant archive members were streamed from the public download; the 171 MB archive is not stored in the project. The source BMPs were converted to lossless grayscale PNGs at the original resolution. All three original RGB channels contained identical values, so storing the one grayscale channel preserves every pixel. No cropping, resizing, retouching, generated content, or gland annotation was applied.

ZIP member CRCs and byte lengths were verified. Reopening each PNG and expanding it to RGB produced exactly the same pixels as its original BMP. Combined image size is **1,020,575 bytes** (approximately 997 KiB). The manifest includes original filenames, dimensions, SHA-256 checksums, source and license URLs, and transformation details.

`samples.json` is an array. The application can fetch it only when the meibography section is opened and load each image on demand through its `src` URL.

The gallery uses separately resized WebP previews, limited to 480 pixels on the longest side and encoded at quality 82. Together they are 21,786 bytes. These derivatives retain the attribution and CC BY 4.0 license above. The manifest's `thumbnail_src` identifies the preview; `src` still identifies the unchanged lossless original used for loading, download, measurements, and model analysis.

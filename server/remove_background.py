"""Bounded, local image worker. Reads one JSON request from stdin; writes PNG JSON."""
import base64
import io
import json
import os
import sys

os.environ.setdefault('OMP_NUM_THREADS', '2')
os.environ.setdefault('U2NET_HOME', '/workspace/rea-image-tools/models')
# Model verification is mandatory, including if a caller's environment disabled it.
os.environ.pop('MODEL_CHECKSUM_DISABLED', None)

from PIL import Image

MAX_PIXELS = 32_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS


def decode_image(value):
    if not isinstance(value, str) or len(value) > 10_000_000:
        raise ValueError('Image exceeds input limit')
    header, encoded = value.split(',', 1)
    if header not in ('data:image/png;base64', 'data:image/jpeg;base64'):
        raise ValueError('Unsupported image type')
    raw = base64.b64decode(encoded, validate=True)
    image = Image.open(io.BytesIO(raw))
    if image.format not in ('PNG', 'JPEG') or image.width * image.height > MAX_PIXELS:
        raise ValueError('Unsupported or oversized image')
    image.load()
    return image.convert('RGBA')


def main():
    raw = sys.stdin.buffer.read(21_000_001)
    if len(raw) > 21_000_000:
        raise ValueError('Request exceeds input limit')
    payload = json.loads(raw)
    image = decode_image(payload['image'])
    mode = sys.argv[1] if len(sys.argv) > 1 else 'background'
    if mode == 'erase':
        import cv2
        import numpy as np
        mask = decode_image(payload['mask'])
        if image.size != mask.size:
            raise ValueError('Mask dimensions must match image')
        mask_array = np.asarray(mask)
        # UI sends opaque white selected pixels on a transparent canvas.
        # Respect alpha so transparent black and transparent white stay unselected.
        selected = ((mask_array[:, :, :3].max(axis=2) > 0) & (mask_array[:, :, 3] > 0)).astype('uint8') * 255
        if selected.all():
            raise ValueError('Select only part of the image')
        rgba = np.asarray(image)
        rgb = cv2.inpaint(rgba[:, :, :3], selected, 3, cv2.INPAINT_TELEA)
        # Erasing restores surrounding color while preserving existing transparency.
        image = Image.fromarray(np.dstack([rgb, rgba[:, :, 3]]))
    elif mode == 'background':
        from rembg import remove, new_session
        session = new_session('u2netp', providers=['CPUExecutionProvider'])
        image = remove(image, session=session)
    else:
        raise ValueError('Unknown operation')
    output = io.BytesIO()
    image.save(output, format='PNG')
    if output.tell() > 32_000_000:
        raise ValueError('Output exceeds size limit')
    print(json.dumps({'image': 'data:image/png;base64,' + base64.b64encode(output.getvalue()).decode('ascii')}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # No image bytes or request metadata in error output.
        print(type(error).__name__ + ': image processing failed', file=sys.stderr)
        sys.exit(1)

import struct, zlib, os

def make_png(width, height, r, g, b):
    def chunk(name, data):
        c = zlib.crc32(name + data) & 0xffffffff
        return struct.pack('>I', len(data)) + name + data + struct.pack('>I', c)
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    row = b'\x00' + bytes([r, g, b] * width)
    raw = row * height
    idat = zlib.compress(raw)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

os.makedirs('assets/images', exist_ok=True)
with open('assets/images/icon.png', 'wb') as f:
    f.write(make_png(1024, 1024, 30, 60, 114))
with open('assets/images/adaptive-icon.png', 'wb') as f:
    f.write(make_png(1024, 1024, 45, 90, 160))
with open('assets/images/splash.png', 'wb') as f:
    f.write(make_png(1284, 2778, 30, 60, 114))
with open('assets/images/favicon.png', 'wb') as f:
    f.write(make_png(32, 32, 30, 60, 114))
print("Created:", os.listdir('assets/images'))

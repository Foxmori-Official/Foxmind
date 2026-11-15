import sharp from 'sharp'

for (const size of [16, 32, 48, 128, 512]) {
  await sharp('public/icons/foxmind.svg', { density: 384 })
    .resize(size, size)
    .png()
    .toFile('public/icons/foxmind-' + size + '.png')
}

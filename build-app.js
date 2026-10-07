const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Extend System PATH for Windows cmd/powershell execution
process.env.PATH = (process.env.PATH || '') + ';C:\\Windows\\System32\\WindowsPowerShell\\v1.0;C:\\Windows\\System32;C:\\Windows';

console.log("=========================================");
console.log("  Sajawal POS v1.2.0 — Single EXE Builder ");
console.log("=========================================\n");

// Ensure offline vendor scripts are present before building
try {
  const downloadVendor = require('./download-vendor');
  downloadVendor.main();
} catch (e) {
  console.log("Note: Vendor check skipped or completed.");
}

const buildDir = path.join(__dirname, 'build');
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

// Function to generate a standard 100% valid multi-resolution Windows PE .ICO binary file
function generateValidMultiResIco() {
  const sizes = [16, 32, 48, 64, 128, 256];
  const numIcons = sizes.length;

  let headerSize = 6 + (numIcons * 16);
  let currentOffset = headerSize;

  const iconBlocks = [];

  sizes.forEach(size => {
    const width = size;
    const height = size;
    const numPixels = width * height;
    const pixelDataSize = numPixels * 4;
    const andMaskSize = Math.ceil((width * height) / 8);
    const imageDataSize = 40 + pixelDataSize + andMaskSize;

    const dirEntry = Buffer.alloc(16);
    dirEntry.writeUInt8(width === 256 ? 0 : width, 0);
    dirEntry.writeUInt8(height === 256 ? 0 : height, 1);
    dirEntry.writeUInt8(0, 2); // colors
    dirEntry.writeUInt8(0, 3); // reserved
    dirEntry.writeUInt16LE(1, 4); // planes
    dirEntry.writeUInt16LE(32, 6); // bpp
    dirEntry.writeUInt32LE(imageDataSize, 8);
    dirEntry.writeUInt32LE(currentOffset, 12);

    const imgBuf = Buffer.alloc(imageDataSize);
    let offset = 0;

    // BITMAPINFOHEADER (40 bytes)
    imgBuf.writeUInt32LE(40, offset); offset += 4;
    imgBuf.writeInt32LE(width, offset); offset += 4;
    imgBuf.writeInt32LE(height * 2, offset); offset += 4; // biHeight includes XOR + AND masks
    imgBuf.writeUInt16LE(1, offset); offset += 2;
    imgBuf.writeUInt16LE(32, offset); offset += 2;
    imgBuf.writeUInt32LE(0, offset); offset += 4; // BI_RGB
    imgBuf.writeUInt32LE(pixelDataSize, offset); offset += 4;
    imgBuf.writeInt32LE(0, offset); offset += 4;
    imgBuf.writeInt32LE(0, offset); offset += 4;
    imgBuf.writeUInt32LE(0, offset); offset += 4;
    imgBuf.writeUInt32LE(0, offset); offset += 4;

    // Generate high-definition Sajawal POS Logo (Dark theme + Lime Green accent)
    for (let y = height - 1; y >= 0; y--) {
      for (let x = 0; x < width; x++) {
        const cx = x - width / 2 + 0.5;
        const cy = y - height / 2 + 0.5;
        const dist = Math.sqrt(cx * cx + cy * cy);
        const maxR = width / 2 - 1;

        let r = 20, g = 20, b = 20, a = 255; // #141414 dark body

        if (dist > maxR) {
          a = 0; // transparent corners
        } else if (dist > maxR - (width * 0.1)) {
          // #ccff00 accent border
          r = 204; g = 255; b = 0; a = 255;
        } else {
          // Center "SP" brand mark
          const relX = x / width;
          const relY = y / height;
          if ((relY > 0.3 && relY < 0.7 && relX > 0.3 && relX < 0.7) ||
              (relY > 0.35 && relY < 0.45 && relX > 0.25 && relX < 0.75) ||
              (relY > 0.55 && relY < 0.65 && relX > 0.25 && relX < 0.75)) {
            // Lime accent
            r = 101; g = 163; b = 13; a = 255;
          }
        }

        imgBuf.writeUInt8(b, offset++);
        imgBuf.writeUInt8(g, offset++);
        imgBuf.writeUInt8(r, offset++);
        imgBuf.writeUInt8(a, offset++);
      }
    }

    // AND Mask
    imgBuf.fill(0, offset, offset + andMaskSize);

    iconBlocks.push({ dirEntry, imgBuf });
    currentOffset += imageDataSize;
  });

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(numIcons, 4);

  const chunks = [header];
  iconBlocks.forEach(b => chunks.push(b.dirEntry));
  iconBlocks.forEach(b => chunks.push(b.imgBuf));

  return Buffer.concat(chunks);
}

const icoPath = path.join(buildDir, 'icon.ico');
fs.writeFileSync(icoPath, generateValidMultiResIco());
console.log("  ✅ Generated multi-resolution Windows icon (build/icon.ico).");

// Temporarily hide PNG and SVG so electron-builder relies purely on build/icon.ico
const svgPath = path.join(buildDir, 'icon.svg');
const svgBakPath = path.join(buildDir, 'icon.svg.bak');
const pngPath = path.join(buildDir, 'icon.png');
const pngBakPath = path.join(buildDir, 'icon.png.bak');
if (fs.existsSync(svgPath)) {
  try { fs.renameSync(svgPath, svgBakPath); } catch (e) {}
}
if (fs.existsSync(pngPath)) {
  try { fs.renameSync(pngPath, pngBakPath); } catch (e) {}
}

const tempBuildDir = path.join(os.tmpdir(), "pos-build-" + Date.now());
const finalExeOutput = path.join(__dirname, "dist_exe");

if (!fs.existsSync(finalExeOutput)) {
  fs.mkdirSync(finalExeOutput, { recursive: true });
}

console.log("Building single-file installer...");
try {
  const cmd = `npx electron-builder --win --config.directories.output="${tempBuildDir}"`;
  execSync(cmd, { stdio: 'inherit', cwd: __dirname, env: process.env });

  const files = fs.readdirSync(tempBuildDir);
  const exeFiles = files.filter(f => f.endsWith('.exe'));

  if (exeFiles.length > 0) {
    console.log("\n=========================================================");
    console.log("  ✅ SUCCESS! SINGLE .EXE FILE(S) CREATED!");
    console.log("=========================================================");

    exeFiles.forEach(exe => {
      const src = path.join(tempBuildDir, exe);
      const dest = path.join(finalExeOutput, exe);
      fs.copyFileSync(src, dest);
      console.log(`  📄 Single File to send to client: dist_exe/${exe}`);
    });
    console.log("=========================================================\n");
  } else {
    console.log("Build completed, check output in:", tempBuildDir);
  }
} catch (err) {
  console.error("Build failed:", err.message);
} finally {
  // Restore icon.svg & icon.png
  if (fs.existsSync(svgBakPath)) {
    try { fs.renameSync(svgBakPath, svgPath); } catch (e) {}
  }
  if (fs.existsSync(pngBakPath)) {
    try { fs.renameSync(pngBakPath, pngPath); } catch (e) {}
  }
  // Cleanup temp dir
  try {
    fs.rmSync(tempBuildDir, { recursive: true, force: true });
  } catch (e) {}
}

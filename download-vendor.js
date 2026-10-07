const https = require('https');
const fs = require('fs');
const path = require('path');

const vendorDir = path.join(__dirname, 'js', 'vendor');
if (!fs.existsSync(vendorDir)) {
  fs.mkdirSync(vendorDir, { recursive: true });
}

const vendorFiles = [
  {
    name: 'lucide.min.js',
    url: 'https://cdn.jsdelivr.net/npm/lucide@0.344.0/dist/umd/lucide.min.js'
  },
  {
    name: 'chart.umd.js',
    url: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js'
  },
  {
    name: 'xlsx.full.min.js',
    url: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
  }
];

function downloadUrl(url, dest) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest) && fs.statSync(dest).size > 5000) {
      console.log(`  ✓ ${path.basename(dest)} already present (${fs.statSync(dest).size} bytes).`);
      return resolve();
    }
    console.log(`  ⬇ Downloading ${path.basename(dest)} from CDN...`);
    const file = fs.createWriteStream(dest);
    
    function get(currentUrl) {
      https.get(currentUrl, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Failed to download ${url}: status ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            console.log(`  ✅ Downloaded ${path.basename(dest)} successfully.`);
            resolve();
          });
        });
      }).on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    }
    
    get(url);
  });
}

async function main() {
  console.log('Ensuring offline vendor libraries...');
  for (const item of vendorFiles) {
    const dest = path.join(vendorDir, item.name);
    try {
      await downloadUrl(item.url, dest);
    } catch (err) {
      console.error(`  ⚠️ Warning: Could not fetch ${item.name}: ${err.message}`);
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };

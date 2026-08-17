// چرا یک اسکریپت جدا به‌جای دستور `cp -r` مستقیم توی package.json؟
// چون `cp` روی ویندوز (بدون git-bash/WSL) وجود ندارد؛ fs.cpSync خود Node.js
// روی هر سه سیستم‌عامل یکسان کار می‌کند، پس این کپی همیشه قابل‌اتکاست.
const fs = require('fs');
const path = require('path');

const webDistDir = path.join(__dirname, '..', '..', 'dist');
const targetDir = path.join(__dirname, '..', 'app');

if (!fs.existsSync(webDistDir)) {
  console.error(`❌ خروجی build وب پیدا نشد: ${webDistDir}`);
  console.error('   ابتدا داخل پوشه‌ی samat-admin (یک پوشه بالاتر از electron-app) دستور "npm run build" را اجرا کنید.');
  process.exit(1);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.cpSync(webDistDir, targetDir, { recursive: true });
console.log(`✅ خروجی وب از ${webDistDir} به ${targetDir} کپی شد.`);

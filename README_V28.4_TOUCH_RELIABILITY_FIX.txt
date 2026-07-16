TheView Stock v28.4 — Touch Reliability Fix

สาเหตุที่พบบางปุ่มต้องกดย้ำ:
- ระบบเดิมมี document touchend listener ที่ preventDefault การแตะครั้งถัดไปภายใน 300ms
- เมื่อเลื่อนจอหรือกดปุ่มต่อเนื่อง Safari อาจยกเลิก click ทำให้ต้องกดซ้ำ

แก้ไข:
- ลบ touchend blocker ดังกล่าว
- ใช้ native click ของ Safari โดยตรง
- กำหนด touch-action: manipulation ให้ปุ่มสำคัญ
- ป้องกันข้อความบนปุ่มถูกเลือกโดยไม่ตั้งใจ
- คงระบบป้องกัน pinch gesture เดิม
- ไม่แก้ Firestore Rules

ไฟล์ที่ต้องอัป:
- app.js
- main.css
- index.html
- service-worker.js

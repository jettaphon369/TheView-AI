CHEE CHAN STOCK v34.16.2 SECURITY

เวอร์ชันนี้แก้ครบทั้ง 9 ประเด็นจากการตรวจระบบ และปิด 2 จุดสุดท้ายให้สมบูรณ์

1) Approval Validation ฝั่ง Firestore
- ตรวจว่า productId มีเอกสารสินค้าจริง
- ไม่อนุญาตสร้างหรือแก้รายการของสินค้าที่ Archive หรืออยู่ในถังขยะ
- ตรวจว่า stock เป็นตัวเลขและไม่ติดลบ
- รายการเบิกออกต้องมี qty ไม่เกิน stock ปัจจุบันตั้งแต่ตอนส่งเข้าคิว

2) First Password Gate แบบ Server-side
- ผู้ใช้ไม่มีสิทธิ์แก้ mustChangePassword, passwordChangePending หรือ passwordChangedAt จาก Client
- Cloud Function completeFirstPasswordChange เป็นผู้เปลี่ยนรหัส Firebase Authentication และปลด Gate
- บันทึก Audit Log แบบ immutable
- ไม่มี Client fallback ที่สามารถข้าม Gate ได้
- Storage Rules ใช้ mustChangePassword เป็น Gate เดียวกันกับ Firestore

ไฟล์ใหม่
- functions/index.js
- functions/package.json
- firebase.json
- .firebaserc

ลำดับ Deploy ที่ปลอดภัยและไม่ทำให้เว็บรุ่นเก่าติด Gate

ขั้นที่ 1 Deploy Cloud Function ก่อน
  npm install -g firebase-tools
  firebase login
  cd functions
  npm install
  cd ..
  firebase deploy --only functions:completeFirstPasswordChange

ขั้นที่ 2 Deploy ไฟล์เว็บไซต์ v34.16.2 ขึ้น Cloudflare หรือ GitHub ตามปกติ

ขั้นที่ 3 Publish Rules หลังเว็บใหม่ขึ้นแล้ว
  firebase deploy --only firestore:rules,storage

หลัง Deploy ให้เปิดเว็บใหม่หรือรีเฟรชทุกเครื่องหนึ่งครั้ง เพื่อให้ Service Worker เปลี่ยนเป็น Cache v34.16.2

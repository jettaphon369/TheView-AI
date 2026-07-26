CHEE CHAN STOCK v34.16.1 HOTFIX

แก้ไขหลัก
1. แก้ humanizeAppError ไม่ให้เกิด ReferenceError จากตัวแปร title ที่ไม่ได้ประกาศ
2. ป้องกันจำนวนคงเหลือเริ่มต้นและจุดเตือนสต๊อกต่ำติดลบ ทั้งหน้าเว็บและ Firestore Rules
3. ลบสินค้าถาวรด้วย Transaction พร้อมลบทะเบียน SKU และลบรูปใน Firebase Storage
4. Export Backup ดึงข้อมูลล่าสุดจาก Firestore โดยตรงครบทุก Collection ที่รองรับ พร้อม members และจำนวนเอกสาร
5. Import Backup รักษา Timestamp, ข้าม Log/Audit ID ที่ซ้ำ, รองรับ Backup เก่าที่ไม่มี skuRegistry
6. เพิ่ม Validation Approval ใน Firestore Rules (qty > 0, type in/out, productId, pending)
7. Audit Log เปิดดูแบบ Pagination ครั้งละ 200 รายการ
8. อัปเดต Build/Cache เป็น v34.16.1-HOTFIX

หมายเหตุ
- ไฟล์ members ถูก Export เพื่อเก็บอ้างอิง แต่ Import อัตโนมัติไม่สร้างบัญชี Firebase Authentication
- ต้อง Publish firestore.rules และ storage.rules ตามไฟล์ในชุดนี้เมื่อ Deploy

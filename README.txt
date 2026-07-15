TheView Stock v26.2 — Eye + Permissions Merged Fix

ชุดนี้รวมการแก้ไขทั้งหมดไว้ด้วยกัน:
- ลูกตาดู/ซ่อนรหัสผ่าน หน้า Login
- ลูกตาหน้าตั้งรหัสครั้งแรก
- ลูกตาหน้าเปลี่ยนรหัสในโปรไฟล์
- ลูกตาใน Modal
- พนักงานไม่เห็น Approval
- พนักงานไม่เห็นถังขยะ
- ป้องกันพนักงานเรียกถังขยะโดยตรง
- สมาชิกแก้ข้อมูลโปรไฟล์ของตนเองได้ผ่าน Rules ใหม่

วิธีอัป:
1. GitHub: อัป app.js ทับไฟล์เดิม
2. Firebase Console > Firestore Database > Rules:
   นำ firestore.rules ไปวางทั้งหมด แล้วกด Publish
3. ปิด Safari ทุกแท็บ แล้วเปิด:
   https://jettaphon369.github.io/?v=26.2-merged

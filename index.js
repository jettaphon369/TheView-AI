"use strict";

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {setGlobalOptions} = require("firebase-functions/v2");
const {initializeApp} = require("firebase-admin/app");
const {getAuth} = require("firebase-admin/auth");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");

initializeApp();
setGlobalOptions({region: "asia-southeast1", maxInstances: 10});

const DEFAULT_PASSWORD = "chartered";

exports.completeFirstPasswordChange = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "กรุณาเข้าสู่ระบบก่อนเปลี่ยนรหัสผ่าน");
  }

  const uid = request.auth.uid;
  const newPassword = typeof request.data?.newPassword === "string"
    ? request.data.newPassword
    : "";

  if (newPassword.length < 6) {
    throw new HttpsError("invalid-argument", "รหัสผ่านต้องมีอย่างน้อย 6 ตัว");
  }
  if (newPassword.length > 128) {
    throw new HttpsError("invalid-argument", "รหัสผ่านต้องไม่เกิน 128 ตัว");
  }
  if (newPassword === DEFAULT_PASSWORD) {
    throw new HttpsError("invalid-argument", "กรุณาตั้งรหัสผ่านอื่นที่ไม่ใช่รหัสเริ่มต้น");
  }

  const db = getFirestore();
  const memberRef = db.doc(`members/${uid}`);
  const memberSnap = await memberRef.get();

  if (!memberSnap.exists) {
    throw new HttpsError("not-found", "ไม่พบข้อมูลสมาชิก");
  }

  const member = memberSnap.data() || {};
  if (member.status !== "active") {
    throw new HttpsError("permission-denied", "บัญชีนี้ถูกปิดใช้งาน");
  }
  if (member.mustChangePassword !== true) {
    throw new HttpsError("failed-precondition", "บัญชีนี้ผ่านขั้นตอนตั้งรหัสผ่านครั้งแรกแล้ว");
  }

  // เปลี่ยนรหัสผ่านจริงจาก Admin SDK ก่อน แล้วจึงปลด Gate ใน Firestore
  // ถ้าการเขียน Firestore ล้มเหลว Gate จะยังคงปิดอยู่และผู้ใช้สามารถลองใหม่ได้
  try {
    await getAuth().updateUser(uid, {password: newPassword});
  } catch (error) {
    if (error?.code === "auth/invalid-password") {
      throw new HttpsError("invalid-argument", "รหัสผ่านใหม่ไม่ผ่านเงื่อนไขของ Firebase Authentication");
    }
    throw new HttpsError("internal", "เปลี่ยนรหัสผ่านใน Firebase Authentication ไม่สำเร็จ");
  }

  await db.runTransaction(async (tx) => {
    const freshSnap = await tx.get(memberRef);
    if (!freshSnap.exists) {
      throw new HttpsError("not-found", "ไม่พบข้อมูลสมาชิก");
    }
    const fresh = freshSnap.data() || {};
    if (fresh.status !== "active") {
      throw new HttpsError("permission-denied", "บัญชีนี้ถูกปิดใช้งาน");
    }

    const now = FieldValue.serverTimestamp();
    tx.update(memberRef, {
      mustChangePassword: false,
      passwordChangePending: false,
      passwordChangeStartedAt: FieldValue.delete(),
      passwordChangedAt: now,
      passwordGateVersion: 2,
      passwordGateCompletedBy: "cloud-function"
    });

    const auditRef = db.collection("theviewWorkspaces/main/auditLogs").doc();
    tx.set(auditRef, {
      action: "ตั้งรหัสผ่านครั้งแรกสำเร็จ",
      detail: "เปลี่ยนรหัสผ่านผ่าน Server-side Security Gate",
      actorUid: uid,
      actorName: fresh.displayName || fresh.username || "สมาชิก",
      immutable: true,
      eventId: `PWD-${uid}-${Date.now()}`,
      createdAt: now,
      updatedAt: now,
      securityVersion: 2
    });
  });

  return {ok: true};
});

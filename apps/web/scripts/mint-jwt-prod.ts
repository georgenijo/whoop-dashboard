import { SignJWT } from "jose";
const key = new Uint8Array(Buffer.from(process.env.JWT_SIGNING_KEY!, "base64"));
const now = Math.floor(Date.now() / 1000);
new SignJWT({}).setProtectedHeader({alg:"HS256"}).setSubject("2")
  .setIssuer("coach-api").setIssuedAt(now).setExpirationTime(now+1800)
  .sign(key).then(t => console.log(t));

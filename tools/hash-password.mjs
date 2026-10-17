import { hashPassword } from '../server/security.js';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { password } = JSON.parse(input);
if (!/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8}$/.test(password)) {
  process.stderr.write('비밀번호는 영어와 숫자를 혼용한 8자리여야 합니다.\n');
  process.exit(1);
}
process.stdout.write(`${hashPassword(password)}\n`);

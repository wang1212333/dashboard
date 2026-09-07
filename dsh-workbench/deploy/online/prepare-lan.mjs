import { writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (!existsSync('.env.lan')) writeFileSync('.env.lan', 'PUBLIC_URL=http://10.240.64.182:18087\nALLOW_LAN_HTTP=true\nHOST=0.0.0.0\nPORT=18087\nDATA_DIR=./data-lan\nADMIN_TOKEN='+randomBytes(32).toString('hex')+'\n');

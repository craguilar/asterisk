import {cp,mkdir,mkdtemp} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

// All paths below are release inputs. Keep data directories, user files and keys out.
const root=fileURLToPath(new URL('../',import.meta.url));
const parent=process.argv[2]?resolve(process.argv[2]):await mkdtemp(join(tmpdir(),'asterisk-bundle-'));
await mkdir(parent,{recursive:true});
const dest=join(parent,'Asterisk');
await mkdir(dest); // never mix the release with a pre-existing directory
for(const path of ['dist','public','data','config','migrations','docs','README.md','package.json','package-lock.json','.npmrc','Start Asterisk.cmd','Start Live Asterisk.cmd'])
  await cp(join(root,path),join(dest,path),{recursive:true});
const npm=process.env.npm_execpath;
if(!npm)throw Error('Run through npm run bundle so the active npm installation is used.');
const install=spawnSync(process.execPath,[npm,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:dest,stdio:'inherit'});
if(install.status!==0)throw Error('Release dependency installation failed');
console.log('Runnable distribution: '+dest);

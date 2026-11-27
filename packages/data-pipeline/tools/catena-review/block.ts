/**
 * One entry beside the oracle's block for the same verses: our excerpts and theirs, first words of each.
 *
 *   pnpm exec tsx tools/catena-review/block.ts catena-matt-3-5-6
 */
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../../src/core/paths.js';
import { oracleBlocks } from '../../src/verify-catena-oracle.js';
const D = dataDir;
const id = process.argv[2];
const entries = JSON.parse(fs.readFileSync(path.join(D, 'processed', 'commentary-catena-aurea.json'), 'utf-8'));
const e = entries.find((x: any) => x.id === id);
const [g, ch, v1] = e.startRef.split('.'); const v2 = e.endRef.split('.')[2];
const GOSPEL_FILE: Record<string, string> = { Matt: 'CAMatthew.htm', Mark: 'CAMark.htm', Luke: 'CALuke.htm', John: 'CAJohn.htm' };
const html = fs.readFileSync(path.join(D, 'texts', 'catena', 'oracle', GOSPEL_FILE[g]), 'latin1');
const ours = e.content.split('\n\n').filter((p: string) => p.startsWith('**'));
console.log('OURS', e.source.item, 'leaves', e.source.leafStart, e.source.leafEnd);
ours.forEach((p: string, i: number) => console.log(`  #${i + 1}`, p.slice(0, 130).replace(/\n/g, ' ')));
const ob = oracleBlocks(html, Number(ch)).filter((b) => b.verseStart === Number(v1) && b.verseEnd === Number(v2));
console.log('ORACLE');
ob.forEach((b) => b.excerpts.forEach((x, i) => console.log(`  o${i + 1}`, x.author, ':', x.text.slice(0, 110))));

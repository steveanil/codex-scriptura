import path from 'node:path';
import { importUsfx } from './importers/import-usfx.js';

const dataDir = path.resolve(process.cwd(), '../../data');

importUsfx(
    path.join(dataDir, 'texts/eng-web.usfx.xml'),
    'WEB',
    path.join(dataDir, 'processed/web-verses.json')
);

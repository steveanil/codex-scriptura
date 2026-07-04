import path from 'node:path';
import { importUsfx } from './importers/import-usfx.js';
import { dataDir } from './core/paths.js';

importUsfx(
    path.join(dataDir, 'texts/eng-web.usfx.xml'),
    'WEB',
    path.join(dataDir, 'processed/web-verses.json')
);

import path from 'node:path';
import { importOsis } from './importers/import-osis.js';
import { dataDir } from './core/paths.js';

// KJV
importOsis(
    path.join(dataDir, 'texts/eng-kjv.osis.xml'),
    'KJV',
    path.join(dataDir, 'processed/kjv-verses.json')
);

// OEB
importOsis(
    path.join(dataDir, 'texts/eng-oeb.osis.xml'),
    'OEB',
    path.join(dataDir, 'processed/oeb-verses.json')
);
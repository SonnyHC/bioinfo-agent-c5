import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appRoute, safeAppLink } from '../web/src/navigation.ts';

const catalog = JSON.parse(readFileSync(new URL('../web/src/data/reference-genomes.json', import.meta.url), 'utf8'));
const audit = JSON.parse(readFileSync(new URL('../docs/reference-genomes-audit.json', import.meta.url), 'utf8'));

test('every source row has a recorded outcome; duplicate files are not offered twice', () => {
  assert.equal(audit.decisions.length, audit.sourceRows);
  assert.equal(new Set(audit.decisions.map((r:any)=>r.sourceRow)).size, audit.sourceRows);
  assert.equal(catalog.entries.length, audit.counts.included);
  const sets = catalog.entries.map((e:any) => e.downloads.map((d:any)=>d.url).sort().join('|'));
  assert.equal(new Set(sets).size, sets.length);
  for (const row of audit.decisions.filter((r:any)=>r.action==='merged')) {
    assert.equal(audit.decisions.find((r:any)=>r.sourceRow===row.keptSourceRow).action, 'included');
  }
});

test('sequence and annotation downloads use the same assembly, species and release', () => {
  for (const entry of catalog.entries) {
    assert(entry.downloads.length > 0);
    for (const d of entry.downloads) assert(['https:','http:'].includes(new URL(d.url).protocol));
    if (entry.provider.startsWith('Ensembl')) {
      const dna=entry.downloads.find((d:any)=>d.kind==='fasta').url;
      const gtf=entry.downloads.find((d:any)=>d.kind==='annotation').url;
      assert.equal(dna.match(/release-(\d+)/)[1],gtf.match(/release-(\d+)/)[1]);
      assert.equal(dna.match(/\/fasta\/([^/]+)\//)[1],gtf.match(/\/gtf\/([^/]+)\//)[1]);
      assert.equal(dna.split('/').pop().split('.dna')[0],gtf.split('/').pop().replace(/\.\d+\.gtf\.gz$/,''));
    }
    if (entry.provider.startsWith('NCBI')) {
      for (const d of entry.downloads) assert(d.url.includes('/'+entry.accession+'_'));
    }
    if (entry.provider==='GENCODE') {
      assert.equal(new Set(entry.downloads.map((d:any)=>d.url.match(/release_([^/]+)/)[1])).size,1);
    }
  }
});

test('known species mismatches and unavailable custom builds are excluded', () => {
  for (const row of [5,8,17,28,29,30,144,242,243,306,335]) {
    assert.equal(audit.decisions.find((r:any)=>r.sourceRow===row).action,'removed');
  }
  const goat=catalog.entries.find((e:any)=>e.species==='山羊'&&e.note.includes('软掩蔽'));
  assert(goat.downloads.some((d:any)=>d.url.includes('.dna_sm.')));
  assert(catalog.entries.some((e:any)=>e.accession==='GCF_028858775.2'&&e.downloads[0].url.includes('v2.1_pri')));
});

test('genome links restore the catalog without becoming analysis requests', () => {
  assert.equal(safeAppLink('/?view=genomes'),'/?view=genomes');
  assert.deepEqual(appRoute('/?view=genomes'),{view:'genomes',request:{}});
  assert.equal(safeAppLink('/?view=genomes&url=https://example.com'),undefined);
});

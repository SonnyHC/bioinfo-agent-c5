import { readFileSync, writeFileSync } from 'node:fs';
import { NtExecutable, NtExecutableResource } from 'pe-library';
import { Data, Resource } from 'resedit';

const [input, output, iconPath, version] = process.argv.slice(2);
const exe = NtExecutable.from(readFileSync(input), { ignoreCert: true });
const resources = NtExecutableResource.from(exe);
const icons = Data.IconFile.from(readFileSync(iconPath)).icons.map(item => item.data);
for (const group of Resource.IconGroupEntry.fromEntries(resources.entries)) {
  Resource.IconGroupEntry.replaceIconsForResource(resources.entries, group.id, group.lang, icons);
}
const parts = version.split('.').map(Number);
for (const info of Resource.VersionInfo.fromEntries(resources.entries)) {
  for (const locale of info.getAvailableLanguages()) {
    info.setFileVersion(...parts, 0, locale.lang);
    info.setProductVersion(...parts, 0, locale.lang);
    info.setStringValues(locale, {
      FileDescription: 'BioInfoBuddy',
      ProductName: 'BioInfoBuddy',
      InternalName: 'BioInfoBuddy',
      OriginalFilename: 'BioInfoBuddy.exe',
      CompanyName: 'BioInfoBuddy',
    });
  }
  info.outputToResourceEntries(resources.entries);
}
resources.outputResource(exe);
writeFileSync(output, Buffer.from(exe.generate()));

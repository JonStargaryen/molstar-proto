import * as argparse from 'argparse'
import * as util from 'util'
import { CIF, CifFrame } from '../../mol-io/reader/cif'
import { trajectoryFromMmCIF } from '../../mol-model-formats/structure/mmcif';
import { Model, Structure, StructureElement, StructureProperties } from '../../mol-model/structure';
import { InteractionsProvider } from '../../mol-model-props/computed/interactions';
import { SyncRuntimeContext } from '../../mol-task/execution/synchronous';
import { ajaxGet } from '../../mol-util/data-source';
import fs = require('fs')
import { interactionTypeLabel } from '../../mol-model-props/computed/interactions/common';

const readFileAsync = util.promisify(fs.readFile);

async function runThis(inPath: string, outPath: string) {
    const ctx = { runtime: SyncRuntimeContext, fetch: ajaxGet }

    const cif = await parseCif(await readFile(inPath));
    const models = await getModels(cif.blocks[0]);
    const structure = await getStructure(models[0]);

    await InteractionsProvider.attach(ctx, structure);

    const interactions = InteractionsProvider.get(structure).value
    if (!interactions) return;

    const unitsFeatures = interactions.unitsFeatures;
    const unitsContacts = interactions.unitsContacts;

    const l1 = StructureElement.Location.create(structure);
    const l2 = StructureElement.Location.create(structure);
    let a, b, c1, c2, s1, s2;
    for (let i = 0, il = structure.units.length; i < il; ++i) {
        const unit = structure.units[i];
        l1.unit = unit;
        l2.unit = unit;

        const features = unitsFeatures.get(unit.id)
        if (!features) return;

        const contacts = unitsContacts.get(unit.id)
        if (!contacts) return;

        for (let i = 0; i < contacts.a.length; i++) {
            a = contacts.a[i];
            b = contacts.b[i];
            if (a < b) continue;
            // features.members[features.offsets[contacts.a[i]]]; // works for hbonds
            l1.element = unit.elements[features.members[features.offsets[a]]];
            l2.element = unit.elements[features.members[features.offsets[b]]];
            // TODO + 1 for multiple members
            
            c1 = StructureProperties.chain.auth_asym_id(l1);
            s1 = StructureProperties.residue.label_seq_id(l1);
            c2 = StructureProperties.chain.auth_asym_id(l2);
            s2 = StructureProperties.residue.label_seq_id(l2);

            console.log(`${c1} ${s1} ${c2} ${s2} ${interactionTypeLabel(contacts.edgeProps.type[i])}`)
        
            // TODO cif-export
        }
    }
}

/**
 * Helper method that reads file and returns the data
 * @param path path to file
 */
async function readFile(path: string) {
    if (path.match(/\.bcif$/)) {
        const input = await readFileAsync(path)
        return new Uint8Array(input);
    } else {
        return readFileAsync(path, 'utf8');
    }
}

async function parseCif(data: string|Uint8Array) {
    const comp = CIF.parse(data);
    const parsed = await comp.run();
    if (parsed.isError) throw parsed;
    return parsed.result;
}

async function getModels(frame: CifFrame) {
    return await trajectoryFromMmCIF(frame).run();
}

async function getStructure(model: Model) {
    return Structure.ofModel(model);
}

const parser = new argparse.ArgumentParser({
    addHelp: true,
    description: 'Create a json file that contains all non-covalent interaction information for a PDB structure.'
});
parser.addArgument('in', {
    help: 'Structure source file path.'
});
parser.addArgument('out', {
    help: 'Generated file output path.'
});
interface Args {
    in: string
    out: string
}
const args: Args = parser.parseArgs();

runThis(args.in, args.out);
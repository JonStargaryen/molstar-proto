import * as argparse from 'argparse'
import * as util from 'util'
import { CIF, CifFrame } from '../../mol-io/reader/cif'
import { trajectoryFromMmCIF } from '../../mol-model-formats/structure/mmcif';
import { Model, Structure, StructureElement, StructureProperties, CifExportContext } from '../../mol-model/structure';
import { InteractionsProvider } from '../../mol-model-props/computed/interactions';
import { SyncRuntimeContext } from '../../mol-task/execution/synchronous';
import { ajaxGet } from '../../mol-util/data-source';
import fs = require('fs')
import { interactionTypeLabel } from '../../mol-model-props/computed/interactions/common';
import { Column } from '../../mol-data/db';
import { CifWriter } from '../../mol-io/writer/cif';
import { getModelMmCifCategory, getUniqueEntityIdsFromStructures } from '../../mol-model/structure/export/categories/utils';
import CifCategory = CifWriter.Category

const readFileAsync = util.promisify(fs.readFile);
export const _struct_asym: CifCategory<CifExportContext> = createCategory('interactions');
    function createCategory(categoryName: 'interactions'): CifCategory<CifExportContext> {
        return {
            name: categoryName,
            instance({ structures, cache }) {
                return getCategoryInstance(structures, categoryName, cache);
            }
        };
    }
    
function getCategoryInstance(structures: Structure[], categoryName: 'interactions', cache: any) {
    const category = getModelMmCifCategory(structures[0].model, categoryName);
    if (!category) return CifCategory.Empty;
    const { entity_id } = category;
    const names = cache.uniqueEntityIds || (cache.uniqueEntityIds = getUniqueEntityIdsFromStructures(structures));
    const indices = Column.indicesOf(entity_id, id => names.has(id));
    return CifCategory.ofTable(category, indices);

}
    
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
    let a, b, ii1: InteractionIdentifier, ii2: InteractionIdentifier, ir: InteractionRecord;
    const output: InteractionRecord[] = [];
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
            // skip symmetric contacts
            if (a < b) continue;

            // + 1 needed for contacts with multiple members
            l1.element = unit.elements[features.members[features.offsets[a]] + 1];
            l2.element = unit.elements[features.members[features.offsets[b]] + 1];

            ii1 = {
                auth_asym_id: StructureProperties.chain.auth_asym_id(l1),
                auth_seq_id: StructureProperties.residue.auth_seq_id(l1),
                pdbx_PDB_ins_code: StructureProperties.residue.pdbx_PDB_ins_code(l1),
                label_comp_id: StructureProperties.residue.label_comp_id(l1)
            };
            ii2 = {
                auth_asym_id: StructureProperties.chain.auth_asym_id(l2),
                auth_seq_id: StructureProperties.residue.auth_seq_id(l2),
                pdbx_PDB_ins_code: StructureProperties.residue.pdbx_PDB_ins_code(l2),
                label_comp_id: StructureProperties.residue.label_comp_id(l2)
            };

            ir = {
                partner1: ii1,
                partner2: ii2,
                type: interactionTypeLabel(contacts.edgeProps.type[i])
            }

            output.push(ir);
            console.log(`${JSON.stringify(ir)}`)
        
            // TODO cif-export
        }
    }

    fs.writeFile(outPath, JSON.stringify(output, null, 2), (err) => {
        if (err) throw err;
    });
}

interface InteractionRecord {
    partner1: InteractionIdentifier,
    partner2: InteractionIdentifier,
    type: string
}

interface InteractionIdentifier {
    auth_asym_id: string,
    auth_seq_id: number,
    pdbx_PDB_ins_code?: string,
    label_comp_id: string
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
import * as argparse from 'argparse'
import * as util from 'util'
import { CIF, CifFrame } from '../../mol-io/reader/cif'
import { trajectoryFromMmCIF } from '../../mol-model-formats/structure/mmcif';
import { Model, Structure } from '../../mol-model/structure';
import { InteractionsProvider } from '../../mol-model-props/computed/interactions';
import { SyncRuntimeContext } from '../../mol-task/execution/synchronous';
import { ajaxGet } from '../../mol-util/data-source';
import fs = require('fs')

const readFileAsync = util.promisify(fs.readFile);

async function runThis(inPath: string, outPath: string) {
    const ctx = { runtime: SyncRuntimeContext, fetch: ajaxGet }

    const cif = await parseCif(await readFile(inPath));
    const models = await getModels(cif.blocks[0]);
    const structure = await getStructure(models[0]);

    await InteractionsProvider.attach(ctx, structure);

    const interactions = InteractionsProvider.get(structure).value;
    console.log(interactions);
    const uc = interactions?.unitsContacts.get(0)!;
    // console.log(uc.a);
    // console.log(uc.b);
    // console.log(uc.edgeProps);
    for (let i = 0; i < uc.a.length; i++) {
        console.log((i + 1) + ' ' + uc.a[i] + ' ' + uc.b[i]);
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
import * as argparse from 'argparse'
import fetch from 'node-fetch'
import { runSingle } from './interaction-json';

async function runAll(out: string) {
    const ids: string[] = await fetch('http://www.rcsb.org/pdb/json/getCurrent')
        .then(res => res.json())
        .then(json => json.idList);

    for (let i = 0, j = ids.length; i < 10; i++) {
        const id = ids[i].toLowerCase();
        runSingle(id, out + '/' + id + '.json');
    }
}

const parser = new argparse.ArgumentParser({
    addHelp: true,
    description: 'Create a json file that contains all non-covalent interaction information for all PDB structures.'
});
parser.addArgument('out', {
    help: 'Generated file output directory.'
});
interface Args {
    out: string
}
const args: Args = parser.parseArgs();

runAll(args.out);
import * as argparse from 'argparse'
import { runSingle } from './interaction-json';

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

runSingle(args.in, args.out);
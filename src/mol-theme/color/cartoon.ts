/**
 * Copyright (c) 2023 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import { Color } from '../../mol-util/color';
import { Location } from '../../mol-model/location';
import type { ColorTheme } from '../color';
import { ParamDefinition as PD } from '../../mol-util/param-definition';
import { ThemeDataContext } from '../theme';
import { ChainIdColorTheme, ChainIdColorThemeParams } from './chain-id';
import { UniformColorTheme, UniformColorThemeParams } from './uniform';
import { assertUnreachable } from '../../mol-util/type-helpers';
import { EntityIdColorTheme, EntityIdColorThemeParams } from './entity-id';
import { MoleculeTypeColorTheme, MoleculeTypeColorThemeParams } from './molecule-type';
import { EntitySourceColorTheme, EntitySourceColorThemeParams } from './entity-source';
import { ModelIndexColorTheme, ModelIndexColorThemeParams } from './model-index';
import { StructureIndexColorTheme, StructureIndexColorThemeParams } from './structure-index';
import { ColorThemeCategory } from './categories';
import { ResidueNameColorTheme, ResidueNameColorThemeParams } from './residue-name';
import { ScaleLegend, TableLegend } from '../../mol-util/legend';
import { SecondaryStructureColorTheme, SecondaryStructureColorThemeParams } from './secondary-structure';
import { ElementSymbolColorTheme, ElementSymbolColorThemeParams } from './element-symbol';

const Description = 'Uses separate themes for coloring mainchain and sidechain visuals.';

export const CartoonColorThemeParams = {
    mainchain: PD.MappedStatic('molecule-type', {
        uniform: PD.Group(UniformColorThemeParams),
        'chain-id': PD.Group(ChainIdColorThemeParams),
        'entity-id': PD.Group(EntityIdColorThemeParams),
        'entity-source': PD.Group(EntitySourceColorThemeParams),
        'molecule-type': PD.Group(MoleculeTypeColorThemeParams),
        'model-index': PD.Group(ModelIndexColorThemeParams),
        'structure-index': PD.Group(StructureIndexColorThemeParams),
        'secondary-structure': PD.Group(SecondaryStructureColorThemeParams),
    }),
    sidechain: PD.MappedStatic('residue-name', {
        uniform: PD.Group(UniformColorThemeParams),
        'residue-name': PD.Group(ResidueNameColorThemeParams),
        'element-symbol': PD.Group(ElementSymbolColorThemeParams),
    }),
};
export type CartoonColorThemeParams = typeof CartoonColorThemeParams
export function getCartoonColorThemeParams(ctx: ThemeDataContext) {
    const params = PD.clone(CartoonColorThemeParams);
    return params;
}

type CartoonColorThemeProps = PD.Values<CartoonColorThemeParams>

function getMainchainTheme(ctx: ThemeDataContext, props: CartoonColorThemeProps['mainchain']) {
    switch (props.name) {
        case 'uniform': return UniformColorTheme(ctx, props.params);
        case 'chain-id': return ChainIdColorTheme(ctx, props.params);
        case 'entity-id': return EntityIdColorTheme(ctx, props.params);
        case 'entity-source': return EntitySourceColorTheme(ctx, props.params);
        case 'molecule-type': return MoleculeTypeColorTheme(ctx, props.params);
        case 'model-index': return ModelIndexColorTheme(ctx, props.params);
        case 'structure-index': return StructureIndexColorTheme(ctx, props.params);
        case 'secondary-structure': return SecondaryStructureColorTheme(ctx, props.params);
        default: assertUnreachable(props);
    }
}

function getSidechainTheme(ctx: ThemeDataContext, props: CartoonColorThemeProps['sidechain']) {
    switch (props.name) {
        case 'uniform': return UniformColorTheme(ctx, props.params);
        case 'residue-name': return ResidueNameColorTheme(ctx, props.params);
        case 'element-symbol': return ElementSymbolColorTheme(ctx, props.params);
        default: assertUnreachable(props);
    }
}

export function CartoonColorTheme(ctx: ThemeDataContext, props: PD.Values<CartoonColorThemeParams>): ColorTheme<CartoonColorThemeParams> {
    const mainchain = getMainchainTheme(ctx, props.mainchain);
    const sidechain = getSidechainTheme(ctx, props.sidechain);

    function color(location: Location, isSecondary: boolean): Color {
        return isSecondary ? mainchain.color(location, false) : sidechain.color(location, false);
    }

    let legend: ScaleLegend | TableLegend | undefined = mainchain.legend;
    if (mainchain.legend?.kind === 'table-legend' && sidechain.legend?.kind === 'table-legend') {
        legend = {
            kind: 'table-legend',
            table: [...mainchain.legend.table, ...sidechain.legend.table]
        };
    }

    return {
        factory: CartoonColorTheme,
        granularity: 'group',
        preferSmoothing: false,
        color,
        props,
        description: Description,
        legend,
    };
}

export const CartoonColorThemeProvider: ColorTheme.Provider<CartoonColorThemeParams, 'cartoon'> = {
    name: 'cartoon',
    label: 'Cartoon',
    category: ColorThemeCategory.Misc,
    factory: CartoonColorTheme,
    getParams: getCartoonColorThemeParams,
    defaultValues: PD.getDefaultValues(CartoonColorThemeParams),
    isApplicable: (ctx: ThemeDataContext) => !!ctx.structure
};
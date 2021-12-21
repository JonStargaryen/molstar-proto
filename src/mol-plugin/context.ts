/**
 * Copyright (c) 2018-2021 mol* contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 * @author Alexander Rose <alexander.rose@weirdbyte.de>
 */

import produce, { setAutoFreeze } from 'immer';
import { List } from 'immutable';
import { merge, Subscription } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { Canvas3D, Canvas3DContext, DefaultCanvas3DParams } from '../mol-canvas3d/canvas3d';
import { resizeCanvas } from '../mol-canvas3d/util';
import { Vec2 } from '../mol-math/linear-algebra';
import { CustomProperty } from '../mol-model-props/common/custom-property';
import { Model, Structure } from '../mol-model/structure';
import { DataBuilder } from '../mol-plugin-state/builder/data';
import { StructureBuilder } from '../mol-plugin-state/builder/structure';
import { DataFormatRegistry } from '../mol-plugin-state/formats/registry';
import { StructureSelectionQueryRegistry } from '../mol-plugin-state/helpers/structure-selection-query';
import { PluginAnimationManager } from '../mol-plugin-state/manager/animation';
import { CameraManager } from '../mol-plugin-state/manager/camera';
import { InteractivityManager } from '../mol-plugin-state/manager/interactivity';
import { LociLabel, LociLabelManager } from '../mol-plugin-state/manager/loci-label';
import { PluginStateSnapshotManager } from '../mol-plugin-state/manager/snapshots';
import { StructureComponentManager } from '../mol-plugin-state/manager/structure/component';
import { StructureFocusManager } from '../mol-plugin-state/manager/structure/focus';
import { StructureHierarchyManager } from '../mol-plugin-state/manager/structure/hierarchy';
import { StructureHierarchyRef } from '../mol-plugin-state/manager/structure/hierarchy-state';
import { StructureMeasurementManager } from '../mol-plugin-state/manager/structure/measurement';
import { StructureSelectionManager } from '../mol-plugin-state/manager/structure/selection';
import { VolumeHierarchyManager } from '../mol-plugin-state/manager/volume/hierarchy';
import { LeftPanelTabName, PluginLayout } from './layout';
import { Representation } from '../mol-repr/representation';
import { StructureRepresentationRegistry } from '../mol-repr/structure/registry';
import { VolumeRepresentationRegistry } from '../mol-repr/volume/registry';
import { StateTransform } from '../mol-state';
import { RuntimeContext, Task } from '../mol-task';
import { ColorTheme } from '../mol-theme/color';
import { SizeTheme } from '../mol-theme/size';
import { ThemeRegistryContext } from '../mol-theme/theme';
import { AssetManager } from '../mol-util/assets';
import { Color } from '../mol-util/color';
import { ajaxGet } from '../mol-util/data-source';
import { isDebugMode, isProductionMode } from '../mol-util/debug';
import { ModifiersKeys } from '../mol-util/input/input-observer';
import { LogEntry } from '../mol-util/log-entry';
import { objectForEach } from '../mol-util/object';
import { RxEventHelper } from '../mol-util/rx-event-helper';
import { PluginAnimationLoop } from './animation-loop';
import { BuiltInPluginBehaviors } from './behavior';
import { PluginBehavior } from './behavior/behavior';
import { PluginCommandManager } from './command';
import { PluginCommands } from './commands';
import { PluginConfig, PluginConfigManager } from './config';
import { PluginSpec } from './spec';
import { PluginState } from './state';
import { SubstructureParentHelper } from './util/substructure-parent-helper';
import { TaskManager } from './util/task-manager';
import { PluginToastManager } from './util/toast';
import { ViewportScreenshotHelper } from './util/viewport-screenshot';
import { PLUGIN_VERSION, PLUGIN_VERSION_DATE } from './version';

export class PluginContext {
    runTask = <T>(task: Task<T>, params?: { useOverlay?: boolean }) => this.managers.task.run(task, params);
    resolveTask = <T>(object: Task<T> | T | undefined) => {
        if (!object) return void 0;
        if (Task.is(object)) return this.runTask(object);
        return object;
    };

    protected subs: Subscription[] = [];

    private disposed = false;
    private ev = RxEventHelper.create();

    readonly config = new PluginConfigManager(this.spec.config); // needed to init state
    readonly state = new PluginState(this);
    readonly commands = new PluginCommandManager();

    private canvas3dInit = this.ev.behavior<boolean>(false);
    readonly behaviors = {
        state: {
            isAnimating: this.ev.behavior<boolean>(false),
            isUpdating: this.ev.behavior<boolean>(false),
            // TODO: should there be separate "updated" event?
            //   Often, this is used to indicate that the state has updated
            //   and it might not be the best way to react to state updates.
            isBusy: this.ev.behavior<boolean>(false)
        },
        interaction: {
            hover: this.ev.behavior<InteractivityManager.HoverEvent>({ current: Representation.Loci.Empty, modifiers: ModifiersKeys.None, buttons: 0, button: 0 }),
            click: this.ev.behavior<InteractivityManager.ClickEvent>({ current: Representation.Loci.Empty, modifiers: ModifiersKeys.None, buttons: 0, button: 0 }),
            drag: this.ev.behavior<InteractivityManager.DragEvent>({ current: Representation.Loci.Empty, modifiers: ModifiersKeys.None, buttons: 0, button: 0, pageStart: Vec2(), pageEnd: Vec2() }),
            selectionMode: this.ev.behavior<boolean>(false)
        },
        labels: {
            highlight: this.ev.behavior<{ labels: ReadonlyArray<LociLabel> }>({ labels: [] })
        },
        layout: {
            leftPanelTabName: this.ev.behavior<LeftPanelTabName>('root')
        },
        canvas3d: {
            initialized: this.canvas3dInit.pipe(filter(v => !!v), take(1))
        }
    } as const;

    readonly canvas3dContext: Canvas3DContext | undefined;
    readonly canvas3d: Canvas3D | undefined;
    readonly layout = new PluginLayout(this);
    readonly animationLoop = new PluginAnimationLoop(this);

    readonly representation = {
        structure: {
            registry: new StructureRepresentationRegistry(),
            themes: { colorThemeRegistry: ColorTheme.createRegistry(), sizeThemeRegistry: SizeTheme.createRegistry() } as ThemeRegistryContext,
        },
        volume: {
            registry: new VolumeRepresentationRegistry(),
            themes: { colorThemeRegistry: ColorTheme.createRegistry(), sizeThemeRegistry: SizeTheme.createRegistry() } as ThemeRegistryContext
        }
    } as const;

    readonly query = {
        structure: {
            registry: new StructureSelectionQueryRegistry()
        }
    } as const;

    readonly dataFormats = new DataFormatRegistry();

    readonly builders = {
        data: new DataBuilder(this),
        structure: void 0 as any as StructureBuilder
    };

    build() {
        return this.state.data.build();
    }

    readonly helpers = {
        substructureParent: new SubstructureParentHelper(this),
        viewportScreenshot: void 0 as ViewportScreenshotHelper | undefined
    } as const;

    readonly managers = {
        structure: {
            hierarchy: new StructureHierarchyManager(this),
            component: new StructureComponentManager(this),
            measurement: new StructureMeasurementManager(this),
            selection: new StructureSelectionManager(this),
            focus: new StructureFocusManager(this),
        },
        volume: {
            hierarchy: new VolumeHierarchyManager(this)
        },
        interactivity: void 0 as any as InteractivityManager,
        camera: new CameraManager(this),
        animation: new PluginAnimationManager(this),
        snapshot: new PluginStateSnapshotManager(this),
        lociLabels: void 0 as any as LociLabelManager,
        toast: new PluginToastManager(this),
        asset: new AssetManager(),
        task: new TaskManager()
    } as const;

    readonly events = {
        log: this.ev<LogEntry>(),
        task: this.managers.task.events,
        canvas3d: {
            settingsUpdated: this.ev(),
        }
    } as const;

    readonly customModelProperties = new CustomProperty.Registry<Model>();
    readonly customStructureProperties = new CustomProperty.Registry<Structure>();

    readonly customStructureControls = new Map<string, { new(): any /* constructible react components with <action.customControl /> */ }>();
    readonly genericRepresentationControls = new Map<string, (selection: StructureHierarchyManager['selection']) => [StructureHierarchyRef[], string]>();

    /**
     * Used to store application specific custom state which is then available
     * to State Actions and similar constructs via the PluginContext.
     */
    readonly customState: unknown = Object.create(null);

    initViewer(canvas: HTMLCanvasElement, container: HTMLDivElement, canvas3dContext?: Canvas3DContext) {
        try {
            this.layout.setRoot(container);
            if (this.spec.layout && this.spec.layout.initial) this.layout.setProps(this.spec.layout.initial);

            if (canvas3dContext) {
                (this.canvas3dContext as Canvas3DContext) = canvas3dContext;
            } else {
                const antialias = !(this.config.get(PluginConfig.General.DisableAntialiasing) ?? false);
                const preserveDrawingBuffer = !(this.config.get(PluginConfig.General.DisablePreserveDrawingBuffer) ?? false);
                const pixelScale = this.config.get(PluginConfig.General.PixelScale) || 1;
                const pickScale = this.config.get(PluginConfig.General.PickScale) || 0.25;
                const pickPadding = this.config.get(PluginConfig.General.PickPadding) ?? 1;
                const enableWboit = this.config.get(PluginConfig.General.EnableWboit) || false;
                const preferWebGl1 = this.config.get(PluginConfig.General.PreferWebGl1) || false;
                (this.canvas3dContext as Canvas3DContext) = Canvas3DContext.fromCanvas(canvas, { antialias, preserveDrawingBuffer, pixelScale, pickScale, pickPadding, enableWboit, preferWebGl1 });
            }
            (this.canvas3d as Canvas3D) = Canvas3D.create(this.canvas3dContext!);
            this.canvas3dInit.next(true);
            let props = this.spec.canvas3d;

            const backgroundColor = Color(0xFCFBF9);
            if (!props) {
                this.canvas3d?.setProps({ renderer: { backgroundColor } });
            } else {
                if (props.renderer?.backgroundColor === void 0) {
                    props = produce(props, p => {
                        if (p.renderer) p.renderer.backgroundColor = backgroundColor;
                        else p.renderer = { backgroundColor };
                    });
                }
                this.canvas3d?.setProps(props);
            }
            this.animationLoop.start();
            (this.helpers.viewportScreenshot as ViewportScreenshotHelper) = new ViewportScreenshotHelper(this);

            this.subs.push(this.canvas3d!.interaction.click.subscribe(e => this.behaviors.interaction.click.next(e)));
            this.subs.push(this.canvas3d!.interaction.drag.subscribe(e => this.behaviors.interaction.drag.next(e)));
            this.subs.push(this.canvas3d!.interaction.hover.subscribe(e => this.behaviors.interaction.hover.next(e)));
            this.subs.push(this.canvas3d!.input.resize.subscribe(() => this.handleResize()));
            this.subs.push(this.layout.events.updated.subscribe(() => requestAnimationFrame(() => this.handleResize())));

            this.handleResize();

            return true;
        } catch (e) {
            this.log.error('' + e);
            console.error(e);
            return false;
        }
    }

    handleResize() {
        const canvas = this.canvas3dContext?.canvas;
        const container = this.layout.root;
        if (container && canvas) {
            const pixelScale = this.config.get(PluginConfig.General.PixelScale) || 1;
            resizeCanvas(canvas, container, pixelScale);
            this.canvas3d?.requestResize();
        }
    }

    readonly log = {
        entries: List<LogEntry>(),
        entry: (e: LogEntry) => this.events.log.next(e),
        error: (msg: string) => this.events.log.next(LogEntry.error(msg)),
        message: (msg: string) => this.events.log.next(LogEntry.message(msg)),
        info: (msg: string) => this.events.log.next(LogEntry.info(msg)),
        warn: (msg: string) => this.events.log.next(LogEntry.warning(msg)),
    };

    /**
     * This should be used in all transform related request so that it could be "spoofed" to allow
     * "static" access to resources.
     */
    readonly fetch = ajaxGet;

    /** return true is animating or updating */
    get isBusy() {
        return this.behaviors.state.isAnimating.value || this.behaviors.state.isUpdating.value;
    }

    get selectionMode() {
        return this.behaviors.interaction.selectionMode.value;
    }

    set selectionMode(mode: boolean) {
        this.behaviors.interaction.selectionMode.next(mode);
    }

    dataTransaction(f: (ctx: RuntimeContext) => Promise<void> | void, options?: { canUndo?: string | boolean, rethrowErrors?: boolean }) {
        return this.runTask(this.state.data.transaction(f, options));
    }

    clear(resetViewportSettings = false) {
        if (resetViewportSettings) this.canvas3d?.setProps(DefaultCanvas3DParams);
        return PluginCommands.State.RemoveObject(this, { state: this.state.data, ref: StateTransform.RootRef });
    }

    dispose(options?: { doNotForceWebGLContextLoss?: boolean }) {
        if (this.disposed) return;

        for (const s of this.subs) {
            s.unsubscribe();
        }
        this.subs = [];

        this.commands.dispose();
        this.canvas3d?.dispose();
        this.canvas3dContext?.dispose(options);
        this.ev.dispose();
        this.state.dispose();
        this.managers.task.dispose();
        this.helpers.substructureParent.dispose();

        objectForEach(this.managers, m => (m as any)?.dispose?.());
        objectForEach(this.managers.structure, m => (m as any)?.dispose?.());

        this.disposed = true;
    }

    private initBehaviorEvents() {
        this.subs.push(merge(this.state.data.behaviors.isUpdating, this.state.behaviors.behaviors.isUpdating).subscribe(u => {
            if (this.behaviors.state.isUpdating.value !== u) this.behaviors.state.isUpdating.next(u);
        }));

        const timeoutMs = this.config.get(PluginConfig.General.IsBusyTimeoutMs) || 750;
        const isBusy = this.behaviors.state.isBusy;

        let timeout: any = void 0;
        const setBusy = () => {
            if (!isBusy.value) isBusy.next(true);
        };
        const reset = () => {
            if (timeout !== void 0) clearTimeout(timeout);
            timeout = void 0;
        };

        this.subs.push(merge(this.behaviors.state.isUpdating, this.behaviors.state.isAnimating).subscribe(v => {
            const isUpdating = this.behaviors.state.isUpdating.value;
            const isAnimating = this.behaviors.state.isAnimating.value;

            if (isUpdating || isAnimating) {
                if (!isBusy.value) {
                    reset();
                    timeout = setTimeout(setBusy, timeoutMs);
                }
            } else {
                reset();
                isBusy.next(false);
            }
        }));

        this.subs.push(this.behaviors.interaction.selectionMode.subscribe(v => {
            if (!v) {
                this.managers.interactivity?.lociSelects.deselectAll();
            }
        }));
    }

    private initBuiltInBehavior() {
        BuiltInPluginBehaviors.State.registerDefault(this);
        BuiltInPluginBehaviors.Representation.registerDefault(this);
        BuiltInPluginBehaviors.Camera.registerDefault(this);
        BuiltInPluginBehaviors.Misc.registerDefault(this);

        this.subs.push(merge(this.state.data.events.log, this.state.behaviors.events.log).subscribe(e => this.events.log.next(e)));
    }

    private async initBehaviors() {
        let tree = this.state.behaviors.build();

        for (const cat of Object.keys(PluginBehavior.Categories)) {
            tree.toRoot().apply(PluginBehavior.CreateCategory, { label: (PluginBehavior.Categories as any)[cat] }, { ref: cat, state: { isLocked: true } });
        }

        // Init custom properties 1st
        for (const b of this.spec.behaviors) {
            const cat = PluginBehavior.getCategoryId(b.transformer);
            if (cat !== 'custom-props') continue;

            tree.to(PluginBehavior.getCategoryId(b.transformer)).apply(b.transformer, b.defaultParams, { ref: b.transformer.id });
        }
        await this.runTask(this.state.behaviors.updateTree(tree, { doNotUpdateCurrent: true, doNotLogTiming: true }));

        tree = this.state.behaviors.build();
        for (const b of this.spec.behaviors) {
            const cat = PluginBehavior.getCategoryId(b.transformer);
            if (cat === 'custom-props') continue;

            tree.to(PluginBehavior.getCategoryId(b.transformer)).apply(b.transformer, b.defaultParams, { ref: b.transformer.id });
        }
        await this.runTask(this.state.behaviors.updateTree(tree, { doNotUpdateCurrent: true, doNotLogTiming: true }));
    }

    private initCustomFormats() {
        if (!this.spec.customFormats) return;

        for (const f of this.spec.customFormats) {
            this.dataFormats.add(f[0], f[1]);
        }
    }

    private initAnimations() {
        if (!this.spec.animations) return;
        for (const anim of this.spec.animations) {
            this.managers.animation.register(anim);
        }
    }

    private initDataActions() {
        if (!this.spec.actions) return;
        for (const a of this.spec.actions) {
            this.state.data.actions.add(a.action);
        }
    }

    async init() {
        this.subs.push(this.events.log.subscribe(e => this.log.entries = this.log.entries.push(e)));

        this.initCustomFormats();
        this.initBehaviorEvents();
        this.initBuiltInBehavior();

        (this.managers.interactivity as InteractivityManager) = new InteractivityManager(this);
        (this.managers.lociLabels as LociLabelManager) = new LociLabelManager(this);
        (this.builders.structure as StructureBuilder) = new StructureBuilder(this);

        this.initAnimations();
        this.initDataActions();

        await this.initBehaviors();

        this.log.message(`Mol* Plugin ${PLUGIN_VERSION} [${PLUGIN_VERSION_DATE.toLocaleString()}]`);
        if (!isProductionMode) this.log.message(`Development mode enabled`);
        if (isDebugMode) this.log.message(`Debug mode enabled`);
    }

    constructor(public spec: PluginSpec) {
        // the reason for this is that sometimes, transform params get modified inline (i.e. palette.valueLabel)
        // and freezing the params object causes "read-only exception"
        // TODO: is this the best place to do it?
        setAutoFreeze(false);
    }
}
import type { FileDropEvent } from 'file-drop-element';
import type SnackBarElement from 'shared/custom-els/snack-bar';
import type { SnackOptions } from 'shared/custom-els/snack-bar';

import { h, Component } from 'preact';

import { linkRef } from 'shared/prerendered-app/util';
import * as style from './style.css';
import 'add-css:./style.css';
import 'file-drop-element';
import 'shared/custom-els/snack-bar';
import Intro from 'shared/prerendered-app/Intro';
import { filterValidFiles } from 'shared/fileValidation';
import 'shared/custom-els/loading-spinner';

const ROUTE_EDITOR = '/editor';
const ROUTE_BATCH = '/batch';

const importCompress = () => import('client/lazy-app/Compress');
const importBatchCompress = () => import('client/lazy-app/BatchCompress');
const compressPromise = importCompress();
const batchCompressPromise = importBatchCompress();
const swBridgePromise = import('client/lazy-app/sw-bridge');

function back() {
  window.history.back();
}

interface Props {}

interface State {
  awaitingShareTarget: boolean;
  file?: File;
  files?: File[];
  isEditorOpen: Boolean;
  isBatchMode: Boolean;
  Compress?: typeof import('client/lazy-app/Compress').default;
  BatchCompress?: typeof import('client/lazy-app/BatchCompress').default;
  hasCompressLoadFailed: boolean;
  hasBatchCompressLoadFailed: boolean;
}

export default class App extends Component<Props, State> {
  state: State = {
    awaitingShareTarget: new URL(location.href).searchParams.has(
      'share-target',
    ),
    isEditorOpen: location.pathname === ROUTE_EDITOR,
    isBatchMode: location.pathname === ROUTE_BATCH,
    file: undefined,
    files: undefined,
    Compress: undefined,
    BatchCompress: undefined,
    hasCompressLoadFailed: false,
    hasBatchCompressLoadFailed: false,
  };

  snackbar?: SnackBarElement;

  constructor() {
    super();

    this.loadCompress(compressPromise);
    this.loadBatchCompress(batchCompressPromise);

    swBridgePromise.then(async ({ offliner, getSharedImage }) => {
      offliner(this.showSnack);
      if (!this.state.awaitingShareTarget) return;
      const file = await getSharedImage();
      // Remove the ?share-target from the URL
      history.replaceState('', '', '/');
      this.openEditor();
      this.setState({ file, awaitingShareTarget: false });
    });

    // Since iOS 10, Apple tries to prevent disabling pinch-zoom. This is great in theory, but
    // really breaks things on Squoosh, as you can easily end up zooming the UI when you mean to
    // zoom the image. Once you've done this, it's really difficult to undo. Anyway, this seems to
    // prevent it.
    document.body.addEventListener('gesturestart', (event: any) => {
      event.preventDefault();
    });

    window.addEventListener('popstate', this.onPopState);
  }

  private loadCompress(modulePromise = importCompress()) {
    modulePromise.then(
      (module) => this.setState({ Compress: module.default }),
      () => this.setState({ hasCompressLoadFailed: true }),
    );
  }

  private loadBatchCompress(modulePromise = importBatchCompress()) {
    modulePromise.then(
      (module) => this.setState({ BatchCompress: module.default }),
      () => this.setState({ hasBatchCompressLoadFailed: true }),
    );
  }

  private retryLoad = () => {
    const { Compress, BatchCompress } = this.state;
    this.setState({
      hasCompressLoadFailed: false,
      hasBatchCompressLoadFailed: false,
    });
    if (!Compress) this.loadCompress();
    if (!BatchCompress) this.loadBatchCompress();
  };

  private onFileDrop = ({ files }: FileDropEvent) => {
    if (!files || files.length === 0) return;

    const filesArray = Array.from(files);
    const { accepted, rejected } = filterValidFiles(filesArray);

    for (const r of rejected) {
      this.showSnack(`${r.file.name}: ${r.reason}`);
    }

    if (accepted.length === 0) return;

    if (accepted.length > 1) {
      this.openBatchMode();
      this.setState({ files: accepted });
    } else {
      this.openEditor();
      this.setState({ file: accepted[0] });
    }
  };

  private onIntroPickFile = (file: File) => {
    this.openEditor();
    this.setState({ file });
  };

  private onIntroPickFiles = (files: File[]) => {
    this.setState({ files }, () => {
      this.openBatchMode();
    });
  };

  private showSnack = (
    message: string,
    options: SnackOptions = {},
  ): Promise<string> => {
    if (!this.snackbar) throw Error('Snackbar missing');
    return this.snackbar.showSnackbar(message, options);
  };

  private onPopState = () => {
    const path = location.pathname;
    this.setState({
      isEditorOpen: path === ROUTE_EDITOR,
      isBatchMode: path === ROUTE_BATCH,
    });
  };

  private openEditor = () => {
    if (this.state.isEditorOpen) return;
    // Change path, but preserve query string.
    const editorURL = new URL(location.href);
    editorURL.pathname = ROUTE_EDITOR;
    history.pushState(null, '', editorURL.href);
    this.setState({ isEditorOpen: true, isBatchMode: false });
  };

  private openBatchMode = () => {
    if (this.state.isBatchMode) return;
    // Change path, but preserve query string.
    const batchURL = new URL(location.href);
    batchURL.pathname = ROUTE_BATCH;
    history.pushState(null, '', batchURL.href);
    this.setState({ isBatchMode: true, isEditorOpen: false });
  };

  render(
    {}: Props,
    {
      file,
      files,
      isEditorOpen,
      isBatchMode,
      Compress,
      BatchCompress,
      awaitingShareTarget,
      hasCompressLoadFailed,
      hasBatchCompressLoadFailed,
    }: State,
  ) {
    const isEditorMissing = isEditorOpen && !Compress;
    const isBatchMissing = isBatchMode && !BatchCompress;
    const hasLoadFailed =
      (isEditorMissing && hasCompressLoadFailed) ||
      (isBatchMissing && hasBatchCompressLoadFailed);
    const showSpinner =
      awaitingShareTarget || isEditorMissing || isBatchMissing;

    return (
      <div class={style.app}>
        <file-drop onfiledrop={this.onFileDrop} class={style.drop} multiple>
          {hasLoadFailed ? (
            <div class={style.loadError} role="alert">
              <svg
                class={style.loadErrorIcon}
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M23.64 7c-.45-.34-4.93-4-11.64-4-1.5 0-2.89.19-4.15.48L18.18 13.8 23.64 7zm-6.6 8.22L3.27 1.44 2 2.72l2.05 2.06C1.91 5.76.59 6.82.36 7l11.63 14.49.01.01.01-.01 3.9-4.86 3.32 3.32 1.27-1.27-3.46-3.46z" />
              </svg>
              <h2 class={style.loadErrorTitle}>No se pudo abrir el editor</h2>
              <p class={style.loadErrorText}>
                Falta descargar una parte de OptiPix en este dispositivo.
                Conéctate a internet e inténtalo de nuevo.
              </p>
              <div class={style.loadErrorActions}>
                <button class={style.retryButton} onClick={this.retryLoad}>
                  Reintentar
                </button>
                <button class={style.homeButton} onClick={back}>
                  Volver al inicio
                </button>
              </div>
            </div>
          ) : showSpinner ? (
            <loading-spinner class={style.appLoader} />
          ) : isBatchMode && BatchCompress && files && files.length > 0 ? (
            <BatchCompress
              files={files}
              showSnack={this.showSnack}
              onBack={back}
            />
          ) : isEditorOpen && Compress && file ? (
            <Compress file={file} showSnack={this.showSnack} onBack={back} />
          ) : (
            <Intro
              onFile={this.onIntroPickFile}
              onFiles={this.onIntroPickFiles}
              showSnack={this.showSnack}
            />
          )}
          <snack-bar ref={linkRef(this, 'snackbar')} />
        </file-drop>
      </div>
    );
  }
}

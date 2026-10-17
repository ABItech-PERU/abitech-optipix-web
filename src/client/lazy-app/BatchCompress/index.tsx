/**
 * Componente para compresión por lote de múltiples imágenes
 */
import { h, Component } from 'preact';
import * as style from './style.css';
import 'add-css:./style.css';
import { zipSync } from 'fflate';
import '../Compress/custom-els/MultiPanel';
import {
  sniffMimeType,
  canDecodeImageType,
  abortable,
  assertSignal,
  builtinDecode,
  copyExif,
} from '../util';
import { validateFile } from 'shared/fileValidation';
import {
  EncoderState,
  EncoderType,
  encoderMap,
  EncoderOptions,
} from '../feature-meta';
import WorkerBridge from '../worker-bridge';
import type SnackBarElement from 'shared/custom-els/snack-bar';
import Controls from './Controls';
import Summary from './Summary';
import FileList, { ProcessedFile } from './FileList';

interface Props {
  files: File[];
  showSnack: SnackBarElement['showSnackbar'];
  onBack: () => void;
}

interface State {
  loading: boolean;
  progress: number;
  processedFiles: ProcessedFile[];
  encoderState: EncoderState | null;
  encoderType: EncoderType;
  isProcessing: boolean;
  mobileView: boolean;
}

export default class BatchCompress extends Component<Props, State> {
  widthQuery = window.matchMedia('(max-width: 599px)');
  private workerBridge = new WorkerBridge();
  private abortController = new AbortController();

  state: State = {
    loading: false,
    progress: 0,
    processedFiles: this.props.files.map((file) => ({
      originalFile: file,
      originalSize: file.size,
      compressedBlob: null,
      compressedSize: null,
      status: 'pending' as const,
    })),
    encoderState: null,
    encoderType: 'mozJPEG',
    isProcessing: false,
    mobileView: this.widthQuery.matches,
  };

  constructor(props: Props) {
    super(props);
    this.widthQuery.addListener(this.onMobileWidthChange);
  }

  private onMobileWidthChange = () => {
    this.setState({ mobileView: this.widthQuery.matches });
  };

  componentDidMount() {
    import('../sw-bridge').then(({ mainAppLoaded }) => mainAppLoaded());

    // Inicializar con configuración por defecto
    const encoder = encoderMap.mozJPEG;
    this.setState({
      encoderState: {
        type: 'mozJPEG',
        options: encoder.meta.defaultOptions,
      },
    });
  }

  componentWillUnmount() {
    this.widthQuery.removeListener(this.onMobileWidthChange);
    this.abortController.abort();
    // Liberar URLs de descarga
    this.state.processedFiles.forEach((file) => {
      if (file.downloadUrl) {
        URL.revokeObjectURL(file.downloadUrl);
      }
    });
  }

  private decodeImage = async (
    signal: AbortSignal,
    blob: Blob,
  ): Promise<ImageData> => {
    assertSignal(signal);
    const mimeType = await abortable(signal, sniffMimeType(blob));
    const canDecode = await abortable(signal, canDecodeImageType(mimeType));

    try {
      if (!canDecode) {
        if (mimeType === 'image/avif') {
          return await this.workerBridge.avifDecode(signal, blob);
        }
        if (mimeType === 'image/webp') {
          return await this.workerBridge.webpDecode(signal, blob);
        }
        if (mimeType === 'image/jxl') {
          return await this.workerBridge.jxlDecode(signal, blob);
        }
        if (mimeType === 'image/webp2') {
          return await this.workerBridge.wp2Decode(signal, blob);
        }
        if (mimeType === 'image/qoi') {
          return await this.workerBridge.qoiDecode(signal, blob);
        }
      }

      // Usar decodificación nativa del navegador
      return await builtinDecode(signal, blob);
    } catch (error: any) {
      // Mapear errores técnicos a mensajes más amigables para el usuario
      const msg = (() => {
        if (!error) return 'Error al decodificar la imagen.';
        const name = error.name || '';
        const message = String(error.message || error);

        if (
          name === 'InvalidStateError' ||
          message.includes('The source image could not be decoded') ||
          (message.includes('decode') && message.includes('image'))
        ) {
          return 'formato no admitido o archivo corrupto.';
        }

        // Por defecto, un mensaje genérico más amable
        return 'Error al decodificar la imagen.';
      })();

      // eslint-disable-next-line no-console
      console.warn('decodeImage error:', error);
      throw new Error(msg);
    }
  };

  private compressImage = async (
    signal: AbortSignal,
    imageData: ImageData,
    encoderState: EncoderState,
    originalFile: File,
  ): Promise<{ blob: Blob; filename: string }> => {
    const encoder = encoderMap[encoderState.type];

    // Llamar a la función encode
    const result = await encoder.encode(
      signal,
      this.workerBridge,
      imageData,
      encoderState.options as any,
    );

    // Convertir el resultado a Blob si es necesario
    let blob: Blob;
    if (result instanceof Blob) {
      blob = result;
    } else if (result instanceof ArrayBuffer) {
      blob = new Blob([result], { type: encoder.meta.mimeType });
    } else {
      // Es una Promise<ArrayBuffer>
      const arrayBuffer = await result;
      blob = new Blob([arrayBuffer], { type: encoder.meta.mimeType });
    }

    // Generar nuevo nombre de archivo
    const extension = encoder.meta.extension;
    const newFilename = originalFile.name.replace(/\.[^.]+$/, '') + '.' + extension;

    // Preservar metadatos originales si el destino es JPEG
    if (extension === 'jpg') {
      blob = await copyExif(originalFile, blob);
    }

    return { blob, filename: newFilename };
  };

  private processAllImages = async () => {
    const { encoderState, processedFiles } = this.state;

    if (!encoderState) {
      this.props.showSnack(
        'Selecciona una configuración de compresión primero',
      );
      return;
    }

    // Resetear estado de todos los archivos a 'pending' antes de procesar
    this.setState((state) => ({
      processedFiles: state.processedFiles.map((f) => ({
        ...f,
        status: 'pending' as const,
        compressedBlob: null,
        compressedSize: null,
        downloadUrl: undefined,
        downloadFilename: undefined,
        error: undefined,
      })),
      isProcessing: true,
      progress: 0,
    }));

    for (let i = 0; i < processedFiles.length; i++) {
      if (this.abortController.signal.aborted) break;

      const fileInfo = processedFiles[i];

      // Validar tipo y tamaño antes de intentar decodificar usando helper
      try {
        const v = validateFile(fileInfo.originalFile);
        if (!v.valid) {
          this.setState((state) => ({
            processedFiles: state.processedFiles.map((f, idx) =>
              idx === i
                ? { ...f, status: 'error' as const, error: v.reason }
                : f,
            ),
          }));
          this.props.showSnack(`${fileInfo.originalFile.name}: ${v.reason}`);
          continue;
        }
      } catch (e) {
        // si la validación falla inesperadamente, seguimos al flujo normal
      }

      // Actualizar estado a "procesando"
      this.setState((state) => ({
        processedFiles: state.processedFiles.map((f, idx) =>
          idx === i ? { ...f, status: 'processing' as const } : f,
        ),
      }));

      // Dar tiempo al navegador (50ms) para renderizar el estado 'Optimizando...' 
      // antes de que getImageData (bloqueante) congele el hilo principal.
      await new Promise((r) => setTimeout(r, 50));

      try {
        const imageData = await this.decodeImage(
          this.abortController.signal,
          fileInfo.originalFile,
        );

        const { blob, filename } = await this.compressImage(
          this.abortController.signal,
          imageData,
          encoderState,
          fileInfo.originalFile,
        );

        const downloadUrl = URL.createObjectURL(blob);

        // Actualizar estado a "completado"
        this.setState((state) => ({
          processedFiles: state.processedFiles.map((f, idx) =>
            idx === i
              ? {
                  ...f,
                  status: 'completed' as const,
                  compressedBlob: blob,
                  compressedSize: blob.size,
                  downloadUrl,
                  downloadFilename: filename,
                }
              : f,
          ),
          progress: ((i + 1) / processedFiles.length) * 100,
        }));
      } catch (error) {
        // Actualizar estado a "error"
        const errorMessage =
          error instanceof Error ? error.message : 'Error desconocido';

        this.setState((state) => ({
          processedFiles: state.processedFiles.map((f, idx) =>
            idx === i
              ? {
                  ...f,
                  status: 'error' as const,
                  error: errorMessage,
                }
              : f,
          ),
        }));

        this.props.showSnack(
          `Error optimizando ${fileInfo.originalFile.name}: ${errorMessage}`,
        );
      }
    }

    this.setState({ isProcessing: false });
    this.props.showSnack('Optimización por lote completada', {
      timeout: 3000,
      actions: ['CERRAR'],
    });
  };

  private retryFile = async (index: number) => {
    const { encoderState, processedFiles } = this.state;
    const fileInfo = processedFiles[index];

    if (!encoderState) return;

    // Actualizar estado a "procesando"
    this.setState((state) => ({
      processedFiles: state.processedFiles.map((f, idx) =>
        idx === index
          ? { ...f, status: 'processing' as const, error: undefined }
          : f,
      ),
    }));

    try {
      // Validar antes de reintentar
      const v = validateFile(fileInfo.originalFile);
      if (!v.valid) {
        this.setState((state) => ({
          processedFiles: state.processedFiles.map((f, idx) =>
            idx === index
              ? { ...f, status: 'error' as const, error: v.reason }
              : f,
          ),
        }));
        this.props.showSnack(`${fileInfo.originalFile.name}: ${v.reason}`);
        return;
      }

      const imageData = await this.decodeImage(
        this.abortController.signal,
        fileInfo.originalFile,
      );

      const { blob, filename } = await this.compressImage(
        this.abortController.signal,
        imageData,
        encoderState,
        fileInfo.originalFile,
      );

      const downloadUrl = URL.createObjectURL(blob);

      // Actualizar estado a "completado"
      this.setState((state) => ({
        processedFiles: state.processedFiles.map((f, idx) =>
          idx === index
            ? {
                ...f,
                status: 'completed' as const,
                compressedBlob: blob,
                compressedSize: blob.size,
                downloadUrl,
                downloadFilename: filename,
              }
            : f,
        ),
      }));

      this.props.showSnack('Archivo optimizado correctamente', {
        timeout: 2000,
        actions: [],
      });
    } catch (error) {
      // Actualizar estado a "error"
      const errorMessage =
        error instanceof Error ? error.message : 'Error desconocido';

      this.setState((state) => ({
        processedFiles: state.processedFiles.map((f, idx) =>
          idx === index
            ? {
                ...f,
                status: 'error' as const,
                error: errorMessage,
              }
            : f,
        ),
      }));

      this.props.showSnack(
        `Error optimizando ${fileInfo.originalFile.name}: ${errorMessage}`,
      );
    }
  };

  private removeFile = (index: number) => {
    this.setState((state) => {
      const file = state.processedFiles[index];
      if (file && file.downloadUrl) {
        URL.revokeObjectURL(file.downloadUrl);
      }
      return {
        processedFiles: state.processedFiles.filter((_, idx) => idx !== index),
      };
    });
  };

  private downloadAll = async () => {
    const { processedFiles } = this.state;
    const completedFiles = processedFiles.filter(
      (f) => f.status === 'completed',
    );

    if (completedFiles.length === 0) {
      this.props.showSnack('Sin archivos procesados para descargar');
      return;
    }

    try {
      this.props.showSnack(
        `Preparando descarga de ${completedFiles.length} imágenes...`,
      );

      // Bloques de 50 máximo para evitar colapsar la RAM
      const CHUNK_SIZE = 50;
      const chunks = [];
      for (let i = 0; i < completedFiles.length; i += CHUNK_SIZE) {
        chunks.push(completedFiles.slice(i, i + CHUNK_SIZE));
      }

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const zipData: { [key: string]: Uint8Array } = {};

        // Convertir cada blob a Uint8Array
        for (const file of chunk) {
          if (file.compressedBlob && file.downloadFilename) {
            const arrayBuffer = await file.compressedBlob.arrayBuffer();
            zipData[file.downloadFilename] = new Uint8Array(arrayBuffer);
          }
        }

        // Crear el ZIP del bloque
        const zipBuffer = zipSync(zipData);

        // Crear blob del ZIP
        const zipBlob = new Blob([new Uint8Array(zipBuffer)], {
          type: 'application/zip',
        });

        // Crear URL para descarga
        const zipUrl = URL.createObjectURL(zipBlob);

        // Crear enlace de descarga
        const a = document.createElement('a');
        a.href = zipUrl;
        
        // Añadir sufijo de parte si hay más de 1 bloque
        const partSuffix = chunks.length > 1 ? `-parte${i + 1}` : '';
        a.download = `optipix-${new Date().toISOString().split('T')[0]}${partSuffix}.zip`;
        a.click();

        // Pausa breve para que el navegador gestione descargas múltiples sin bloquear
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Liberar URL de memoria
        URL.revokeObjectURL(zipUrl);
      }

      this.props.showSnack(
        `Descarga completada en ${chunks.length} archivo(s) ZIP`,
        { timeout: 4000 },
      );
    } catch (error) {
      this.props.showSnack('Error al crear archivos ZIP');
      console.error('Error en downloadAll:', error);
    }
  };

  private onEncoderTypeChange = (event: Event) => {
    const select = event.target as HTMLSelectElement;
    const encoderType = select.value as EncoderType;
    const encoder = encoderMap[encoderType];

    // Helper para crear estado de encoder con tipo correcto
    const createEncoderState = (type: EncoderType): EncoderState => {
      return {
        type,
        options: encoderMap[type].meta.defaultOptions,
      } as EncoderState;
    };

    this.setState({
      encoderType,
      encoderState: createEncoderState(encoderType),
    });
  };

  private onEncoderOptionsChange = (newOptions: EncoderOptions) => {
    const { encoderType } = this.state;

    // Helper para crear estado de encoder con tipo correcto
    const createEncoderState = (
      type: EncoderType,
      options: any,
    ): EncoderState => {
      return {
        type,
        options,
      } as EncoderState;
    };

    this.setState({
      encoderState: createEncoderState(encoderType, newOptions),
    });
  };

  render(
    {}: Props,
    {
      processedFiles,
      isProcessing,
      progress,
      encoderType,
      encoderState,
      mobileView,
    }: State,
  ) {
    const totalOriginalSize = processedFiles.reduce(
      (sum, f) => sum + f.originalSize,
      0,
    );
    const totalCompressedSize = processedFiles.reduce(
      (sum, f) => sum + (f.compressedSize || 0),
      0,
    );
    const completedCount = processedFiles.filter(
      (f) => f.status === 'completed',
    ).length;

    const controls = (
      <Controls
        encoderType={encoderType}
        encoderState={encoderState}
        isProcessing={isProcessing}
        progress={progress}
        completedCount={completedCount}
        totalFiles={processedFiles.length}
        onEncoderTypeChange={this.onEncoderTypeChange}
        onEncoderOptionsChange={this.onEncoderOptionsChange}
        onProcessAll={this.processAllImages}
        onDownloadAll={this.downloadAll}
      />
    );

    const content = (
      <div class={style.contentArea}>
        <Summary
          totalOriginalSize={totalOriginalSize}
          totalCompressedSize={totalCompressedSize}
        />

        <FileList 
          files={processedFiles} 
          onRetry={this.retryFile} 
          onRemove={this.removeFile} 
        />
      </div>
    );

    return (
      <div class={style.batchCompress}>
        <header class={style.header}>
          <button class={style.back} onClick={this.props.onBack}>
            <svg viewBox="0 0 61 53.3">
              <title>Back</title>
              <path
                class={style.backBlob}
                d="M0 25.6c-.5-7.1 4.1-14.5 10-19.1S23.4.1 32.2 0c8.8 0 19 1.6 24.4 8s5.6 17.8 1.7 27a29.7 29.7 0 01-20.5 18c-8.4 1.5-17.3-2.6-24.5-8S.5 32.6.1 25.6z"
              />
              <path
                class={style.backX}
                d="M41.6 17.1l-2-2.1-8.3 8.2-8.2-8.2-2 2 8.2 8.3-8.3 8.2 2.1 2 8.2-8.1 8.3 8.2 2-2-8.2-8.3z"
              />
            </svg>
          </button>

          <div class={style.fileCount}>
            {completedCount} / {processedFiles.length}
          </div>
        </header>

        {mobileView ? (
          <div class={style.mobileLayout}>
            <div class={style.sidebarMobile}>{controls}</div>
            <div class={style.mainMobile}>{content}</div>
          </div>
        ) : (
          <div class={style.desktopLayout}>
            <div class={style.sidebar}>{controls}</div>
            <div class={style.main}>{content}</div>
          </div>
        )}
      </div>
    );
  }
}

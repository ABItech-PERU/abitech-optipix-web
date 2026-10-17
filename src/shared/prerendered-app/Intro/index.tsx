import { h, Component } from 'preact';

import { linkRef } from 'shared/prerendered-app/util';
import '../../custom-els/loading-spinner';
import githubLogo from 'url:./imgs/github-logo.svg';
import largePhoto from 'url:./imgs/demos/demo-large-photo.jpg';

import largePhotoIcon from 'url:./imgs/demos/icon-demo-large-photo.jpg';
import smallSectionAsset from 'url:./imgs/info-content/small.svg';
import simpleSectionAsset from 'url:./imgs/info-content/simple.svg';
import secureSectionAsset from 'url:./imgs/info-content/secure.svg';
import multiImagesSectionAsset from 'url:./imgs/info-content/multi-images.svg';
import logoOptiPixSvg from 'data-url-text:./imgs/logo-with-text.svg';

import banderaPeru from 'url:./imgs/demos/demo-bandera-peru.jpeg';
import iconBanderaPeru from 'url:./imgs/demos/icon-bandera-peru.webp';
import machuPicchu from 'url:./imgs/demos/demo-machu-picchu.jpg';
import iconMachuPicchu from 'url:./imgs/demos/icon-machu-picchu.webp';
import iconOptipix from 'url:./imgs/demos/icon-logo-optipix.webp';
import logoOptiPix from 'url:./imgs/demos/demo-logo-optipix.png';
import hojaNaturalGrande from 'url:./imgs/demos/demo-hoja-natural-grande.jpg';
import hojaNaturalGrandeIcon from 'url:./imgs/demos/icon-hoja-natural-grande.webp';
import sanSebastian from 'url:./imgs/demos/demo-san-sebastian-huanuco.jpg';
import iconSanSebastian from 'url:./imgs/demos/icon-san-sebastian-huanuco.webp';

import * as style from './style.css';
import type SnackBarElement from 'shared/custom-els/snack-bar';
import 'shared/custom-els/snack-bar';
import { startBlobs } from './blob-anim/meta';
import { validateFile, filterValidFiles } from 'shared/fileValidation';
import SlideOnScroll from './SlideOnScroll';

const demos = [
  {
    description: 'Foto grande',
    size: '2.8MB',
    filename: 'photo.jpg',
    url: largePhoto,
    iconUrl: largePhotoIcon,
  },
  {
    description: 'Bandera del Perú',
    size: '1MB',
    filename: 'bandera-peru.jpeg',
    url: banderaPeru,
    iconUrl: iconBanderaPeru,
  },
  {
    description: 'Machu Picchu',
    size: '3MB',
    filename: 'machu-picchu.jpg',
    url: machuPicchu,
    iconUrl: iconMachuPicchu,
  },
  {
    description: 'Hoja natural grande',
    size: '2MB',
    filename: 'hoja-natural-grande.jpg',
    url: hojaNaturalGrande,
    iconUrl: hojaNaturalGrandeIcon,
  },
  {
    description: 'Iglesia san Sebastián',
    size: '11.5MB',
    filename: 'san-sebastian-huanuco.jpg',
    url: sanSebastian,
    iconUrl: iconSanSebastian,
  },
  {
    description: 'Logotipo OptiPix',
    size: '60KB',
    filename: 'logo-optipix.png',
    url: logoOptiPix,
    iconUrl: iconOptipix,
  },
] as const;

const blobAnimImport =
  !__PRERENDER__ && matchMedia('(prefers-reduced-motion: reduce)').matches
    ? undefined
    : import('./blob-anim');
const installButtonSource = 'introInstallButton-Purple';
const supportsClipboardAPI =
  !__PRERENDER__ && navigator.clipboard && navigator.clipboard.read;

async function getImageClipboardItem(
  items: ClipboardItem[],
): Promise<undefined | Blob> {
  for (const item of items) {
    const type = item.types.find((type) => type.startsWith('image/'));
    if (type) return item.getType(type);
  }
}

interface Props {
  onFile?: (file: File) => void;
  onFiles?: (files: File[]) => void;
  showSnack?: SnackBarElement['showSnackbar'];
}
interface State {
  fetchingDemoIndex?: number;
  beforeInstallEvent?: BeforeInstallPromptEvent;
  showBlobSVG: boolean;
}

export default class Intro extends Component<Props, State> {
  state: State = {
    showBlobSVG: true,
  };
  private fileInput?: HTMLInputElement;
  private blobCanvas?: HTMLCanvasElement;
  private installingViaButton = false;

  componentDidMount() {
    // Listen for beforeinstallprompt events, indicating OptiPix is installable.
    window.addEventListener(
      'beforeinstallprompt',
      this.onBeforeInstallPromptEvent,
    );

    // Listen for the appinstalled event, indicating OptiPix has been installed.
    window.addEventListener('appinstalled', this.onAppInstalled);

    if (blobAnimImport) {
      blobAnimImport.then((module) => {
        this.setState(
          {
            showBlobSVG: false,
          },
          () => module.startBlobAnim(this.blobCanvas!),
        );
      });
    }
  }

  componentWillUnmount() {
    window.removeEventListener(
      'beforeinstallprompt',
      this.onBeforeInstallPromptEvent,
    );
    window.removeEventListener('appinstalled', this.onAppInstalled);
  }

  private onFileChange = (event: Event): void => {
    const fileInput = event.target as HTMLInputElement;
    const files = fileInput.files;
    if (!files || files.length === 0) return;

    // Validar tipo y tamaño en el punto de entrada usando helper compartido
    const filesArray = Array.from(files);
    const { accepted, rejected } = filterValidFiles(filesArray);

    for (const r of rejected) {
      this.props.showSnack?.(`${r.file.name}: ${r.reason}`, {
        actions: ['Cerrar'],
      });
    }

    this.fileInput!.value = '';
    if (accepted.length === 0) return;

    if (accepted.length > 1) {
      if (this.props.onFiles) this.props.onFiles(accepted);
    } else {
      if (this.props.onFile) this.props.onFile(accepted[0]);
    }
  };

  private onOpenClick = () => {
    this.fileInput!.click();
  };

  private onDemoClick = async (index: number, event: Event) => {
    try {
      this.setState({ fetchingDemoIndex: index });
      const demo = demos[index];
      const response = await fetch(demo.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const file = new File([blob], demo.filename, { type: blob.type });
      const v = validateFile(file);
      if (!v.valid) {
        this.props.showSnack!(`${file.name}: ${v.reason}`, {
          actions: ['Cerrar'],
        });
        this.setState({ fetchingDemoIndex: undefined });
        return;
      }

      this.props.onFile!(file);
    } catch (err) {
      this.setState({ fetchingDemoIndex: undefined });
      this.props.showSnack!('No se pudo cargar la imagen de demo', {
        timeout: 5000,
        actions: ['Cerrar'],
      });
    }
  };

  private onBeforeInstallPromptEvent = (event: BeforeInstallPromptEvent) => {
    // Don't show the mini-infobar on mobile
    event.preventDefault();

    // Save the beforeinstallprompt event so it can be called later.
    this.setState({ beforeInstallEvent: event });

    // Log the event.
    const gaEventInfo = {
      eventCategory: 'pwa-install',
      eventAction: 'promo-shown',
      nonInteraction: true,
    };
    ga('send', 'event', gaEventInfo);
  };

  private onInstallClick = async (event: Event) => {
    // Get the deferred beforeinstallprompt event
    const beforeInstallEvent = this.state.beforeInstallEvent;
    // If there's no deferred prompt, bail.
    if (!beforeInstallEvent) return;

    this.installingViaButton = true;

    // Show the browser install prompt
    beforeInstallEvent.prompt();

    // Wait for the user to accept or dismiss the install prompt
    const { outcome } = await beforeInstallEvent.userChoice;
    // Send the analytics data
    const gaEventInfo = {
      eventCategory: 'pwa-install',
      eventAction: 'promo-clicked',
      eventLabel: installButtonSource,
      eventValue: outcome === 'accepted' ? 1 : 0,
    };
    ga('send', 'event', gaEventInfo);

    // If the prompt was dismissed, we aren't going to install via the button.
    if (outcome === 'dismissed') {
      this.installingViaButton = false;
    }
  };

  private onAppInstalled = () => {
    // We don't need the install button, if it's shown
    this.setState({ beforeInstallEvent: undefined });

    // Don't log analytics if page is not visible
    if (document.hidden) return;

    // Try to get the install, if it's not set, use 'browser'
    const source = this.installingViaButton ? installButtonSource : 'browser';
    ga('send', 'event', 'pwa-install', 'installed', source);

    // Clear the install method property
    this.installingViaButton = false;
  };

  private onPasteClick = async () => {
    let clipboardItems: ClipboardItem[];

    try {
      clipboardItems = await navigator.clipboard.read();
    } catch (err) {
      this.props.showSnack!(`No hay permiso para acceder al portapapeles`, {
        timeout: 5000,
        actions: ['Cerrar'],
      });
      return;
    }

    const blob = await getImageClipboardItem(clipboardItems);

    if (!blob) {
      this.props.showSnack!(`No se encontró imagen en el portapapeles`, {
        timeout: 5000,
        actions: ['Cerrar'],
      });
      return;
    }

    const file = new File([blob], 'image.unknown', { type: blob.type });

    const v = validateFile(file);
    if (!v.valid) {
      this.props.showSnack!(`${file.name}: ${v.reason}`, {
        actions: ['Cerrar'],
      });
      return;
    }

    this.props.onFile!(file);
  };

  render(
    {}: Props,
    { fetchingDemoIndex, beforeInstallEvent, showBlobSVG }: State,
  ) {
    return (
      <div class={style.intro}>
        <input
          class={style.hide}
          ref={linkRef(this, 'fileInput')}
          type="file"
          multiple
          onChange={this.onFileChange}
        />
        <div class={style.main}>
          {!__PRERENDER__ && (
            <canvas
              ref={linkRef(this, 'blobCanvas')}
              class={style.blobCanvas}
            />
          )}
          <h1 class={style.logoContainer}>
            <img
              class={style.logo}
              src={logoOptiPixSvg}
              alt="OptiPix"
              width="539"
              height="162"
            />
          </h1>
          <div class={style.loadImg}>
            {showBlobSVG && (
              <svg
                class={style.blobSvg}
                viewBox="-1.25 -1.25 2.5 2.5"
                preserveAspectRatio="xMidYMid slice"
              >
                {startBlobs.map((points) => (
                  <path
                    d={points
                      .map((point, i) => {
                        const nextI = i === points.length - 1 ? 0 : i + 1;
                        let d = '';
                        if (i === 0) {
                          d += `M${point[2]} ${point[3]}`;
                        }
                        return (
                          d +
                          `C${point[4]} ${point[5]} ${points[nextI][0]} ${points[nextI][1]} ${points[nextI][2]} ${points[nextI][3]}`
                        );
                      })
                      .join('')}
                  />
                ))}
              </svg>
            )}
            <div
              class={style.loadImgContent}
              style={{ visibility: __PRERENDER__ ? 'hidden' : '' }}
            >
              <button class={style.loadBtn} onClick={this.onOpenClick}>
                <svg viewBox="0 0 24 24" class={style.loadIcon}>
                  <path d="M19 7v3h-2V7h-3V5h3V2h2v3h3v2h-3zm-3 4V8h-3V5H5a2 2 0 00-2 2v12c0 1.1.9 2 2 2h12a2 2 0 002-2v-8h-3zM5 19l3-4 2 3 3-4 4 5H5z" />
                </svg>
              </button>
              <div>
                <span class={style.dropText}>Soltar </span>O{' '}
                {supportsClipboardAPI ? (
                  <button class={style.pasteBtn} onClick={this.onPasteClick}>
                    Pegar
                  </button>
                ) : (
                  'Pegar'
                )}
              </div>
            </div>
          </div>
        </div>
        <div class={style.demosContainer}>
          <svg viewBox="0 0 1920 140" class={style.topWave}>
            <path
              d="M1920 0l-107 28c-106 29-320 85-533 93-213 7-427-36-640-50s-427 0-533 7L0 85v171h1920z"
              class={style.subWave}
            />
            <path
              d="M0 129l64-26c64-27 192-81 320-75 128 5 256 69 384 64 128-6 256-80 384-91s256 43 384 70c128 26 256 26 320 26h64v96H0z"
              class={style.mainWave}
            />
          </svg>
          <div class={style.contentPadding}>
            <p class={style.demoTitle}>
              O <strong>pruebe uno</strong> de estos:
            </p>
            <ul class={style.demos}>
              {demos.map((demo, i) => (
                <li>
                  <button
                    class="unbutton"
                    onClick={(event) => this.onDemoClick(i, event)}
                  >
                    <div class={style.demoContainer}>
                      <div class={style.demoIconContainer}>
                        <img
                          class={style.demoIcon}
                          src={demo.iconUrl}
                          alt={demo.description}
                        />
                        {fetchingDemoIndex === i && (
                          <div class={style.demoLoader}>
                            <loading-spinner />
                          </div>
                        )}
                      </div>
                      <div class={style.demoSize}>{demo.size}</div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div class={style.bottomWave}>
          <svg viewBox="0 0 1920 79" class={style.topWave}>
            <path
              d="M0 59l64-11c64-11 192-34 320-43s256-5 384 4 256 23 384 34 256 21 384 14 256-30 320-41l64-11v94H0z"
              class={style.infoWave}
            />
          </svg>
        </div>

        <section class={style.info}>
          <div class={style.infoContainer}>
            <SlideOnScroll>
              <div class={style.infoContent}>
                <div class={style.infoTextWrapper}>
                  <h2 class={style.infoTitle}>Pequeño</h2>
                  <p class={style.infoCaption}>
                    Las imágenes más pequeñas significan tiempos de carga más
                    rápidos. OptiPix puede reducir el tamaño de los archivos y
                    mantener una alta calidad.
                  </p>
                </div>
                <div class={style.infoImgWrapper}>
                  <img
                    class={style.infoImg}
                    src={smallSectionAsset}
                    alt="silhouette of a large 1.4 megabyte image shrunk into a smaller 80 kilobyte image"
                    width="536"
                    height="522"
                  />
                </div>
              </div>
            </SlideOnScroll>
          </div>
        </section>

        <section class={style.info}>
          <div class={style.infoContainer}>
            <SlideOnScroll>
              <div class={style.infoContent}>
                <div class={style.infoTextWrapper}>
                  <h2 class={style.infoTitle}>Sencillo</h2>
                  <p class={style.infoCaption}>
                    Abra su imagen, inspeccione las diferencias y luego guárdela
                    instantáneamente. ¿te sientes aventurero? Ajuste la
                    configuración para archivos aún más pequeños.
                  </p>
                </div>
                <div class={style.infoImgWrapper}>
                  <img
                    class={style.infoImg}
                    src={simpleSectionAsset}
                    alt="grid of multiple shrunk images displaying various options"
                    width="538"
                    height="384"
                  />
                </div>
              </div>
            </SlideOnScroll>
          </div>
        </section>

        <section class={style.info}>
          <div class={style.infoContainer}>
            <SlideOnScroll>
              <div class={style.infoContent}>
                <div class={style.infoTextWrapper}>
                  <h2 class={style.infoTitle}>Seguro</h2>
                  <p class={style.infoCaption}>
                    ¿Preocupado por la privacidad? Las imágenes nunca salen de
                    su dispositivo ya que OptiPix realiza todo el trabajo
                    localmente.
                  </p>
                </div>
                <div class={style.infoImgWrapper}>
                  <img
                    class={style.infoImg}
                    src={secureSectionAsset}
                    alt="silhouette of a cloud with a 'no' symbol on top"
                    width="498"
                    height="333"
                  />
                </div>
              </div>
            </SlideOnScroll>
          </div>
        </section>

        <section class={style.info}>
          <div class={style.infoContainer}>
            <SlideOnScroll>
              <div class={style.infoContent}>
                <div class={style.infoTextWrapper}>
                  <h2 class={style.infoTitle}>Múltiples fotos</h2>
                  <p class={style.infoCaption}>
                    Cargue varias imágenes a la vez y comprímalas en masa para
                    ahorrar tiempo y esfuerzo.
                  </p>
                </div>
                <div class={style.infoImgWrapper}>
                  <img
                    class={style.infoImg}
                    src={multiImagesSectionAsset}
                    alt="grid of multiple images being compressed at once"
                    width="700"
                  />
                </div>
              </div>
            </SlideOnScroll>
          </div>
        </section>

        <footer class={style.footer}>
          <div class={style.footerContainer}>
            <svg viewBox="0 0 1920 79" class={style.topWave}>
              <path
                d="M0 59l64-11c64-11 192-34 320-43s256-5 384 4 256 23 384 34 256 21 384 14 256-30 320-41l64-11v94H0z"
                class={style.footerWave}
              />
            </svg>
            <div class={style.footerPadding}>
              <footer class={style.footerItems}>
                <div class={style.footerBrand}>
                  <span class={style.footerBrandLabel}>Desarrollado por</span>
                  <a
                    href="https://abitech.com.pe"
                    target="_blank"
                    class={style.footerBrandLink}
                  >
                    <span class={style.footerBrandAbi}>ABI</span>
                    <span class={style.footerBrandTech}>tech</span> PERÚ
                  </a>
                </div>
                <a
                  class={style.footerLinkWithLogo}
                  href="https://github.com/abitech-peru/optipix"
                  target="_blank"
                >
                  <img src={githubLogo} alt="" width="10" height="10" />
                  Ver en Github
                </a>
              </footer>
            </div>
          </div>
        </footer>
        {beforeInstallEvent && (
          <button class={style.installBtn} onClick={this.onInstallClick}>
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              style="margin-right: 0.5em;"
            >
              <path
                d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"
                fill="currentColor"
              />
            </svg>
            Instalar
          </button>
        )}
      </div>
    );
  }
}

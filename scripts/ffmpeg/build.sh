#!/usr/bin/env bash
# 编译随应用分发的最小 ffmpeg / ffprobe（LGPL，不含 GPL 组件）。
# 只开视频库用到的功能：读常见视频（解码 + 解封装）、转成 h264/aac 的 mp4、截 jpg、输出 PCM 算波形。
# 编码 h264 用系统硬件编码：macOS VideoToolbox、Windows Media Foundation；Linux 用 openh264（BSD）。
# AV1 软解用 dav1d（BSD）。依赖都从源码静态编进去，产物只依赖系统库。
#
# 用法：scripts/ffmpeg/build.sh <源码根目录> <输出目录> <目标>
#   源码根目录里放解压好的 ffmpeg-<版本>/、dav1d-<版本>/、openh264-<版本>/（Linux 才需要），版本与哈希见 sources.json
#   目标：macos-arm64 | macos-x86_64 | linux-x86_64 | linux-arm64 | windows-x86_64（在 Linux 上用 mingw 交叉编译）
#   需要：make、C 编译器、meson + ninja、pkg-config；x86 目标需要 nasm
set -euo pipefail

ROOT=$(cd "$1" && pwd)
OUT=$(mkdir -p "$2" && cd "$2" && pwd)
TARGET=$3
JOBS=$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)
SRC=$(echo "$ROOT"/ffmpeg-*/)
DEPS="$OUT/deps-$TARGET"
export PKG_CONFIG_PATH="$DEPS/lib/pkgconfig"
export PKG_CONFIG_LIBDIR="$DEPS/lib/pkgconfig"

# meson 交叉编译文件（本机目标为空）
cross_file() {
  local f="$OUT/cross-$TARGET.ini"
  case "$TARGET" in
    macos-x86_64)
      [ "$(uname -m)" = x86_64 ] && return
      cat >"$f" <<INI
[binaries]
c = ['clang', '-arch', 'x86_64', '-mmacosx-version-min=10.15']
cpp = ['clang++', '-arch', 'x86_64', '-mmacosx-version-min=10.15']
ar = 'ar'
strip = 'strip'
[host_machine]
system = 'darwin'
cpu_family = 'x86_64'
cpu = 'x86_64'
endian = 'little'
INI
      ;;
    windows-x86_64)
      cat >"$f" <<INI
[binaries]
c = 'x86_64-w64-mingw32-gcc'
cpp = 'x86_64-w64-mingw32-g++'
ar = 'x86_64-w64-mingw32-ar'
strip = 'x86_64-w64-mingw32-strip'
windres = 'x86_64-w64-mingw32-windres'
[host_machine]
system = 'windows'
cpu_family = 'x86_64'
cpu = 'x86_64'
endian = 'little'
INI
      ;;
    *) return ;;
  esac
  echo "--cross-file=$f"
}

meson_build() {
  local src=$1 name=$2
  shift 2
  local build="$OUT/build-$name-$TARGET"
  rm -rf "$build"
  local cross extra=()
  cross=$(cross_file)
  if [ -n "$cross" ]; then
    extra+=("$cross")
  elif [[ "$TARGET" == macos-* ]]; then
    extra+=(-Dc_args=-mmacosx-version-min=10.15 -Dc_link_args=-mmacosx-version-min=10.15)
  fi
  meson setup "$build" "$src" --prefix="$DEPS" --libdir=lib \
    --buildtype=release --default-library=static ${extra[@]+"${extra[@]}"} "$@"
  ninja -C "$build" install
}

rm -rf "$DEPS"
DAV1D_ASM=()
case "$TARGET" in
  *x86_64) command -v nasm >/dev/null || DAV1D_ASM=(-Denable_asm=false) ;;
esac
meson_build "$(echo "$ROOT"/dav1d-*/)" dav1d -Denable_tools=false -Denable_tests=false -Denable_examples=false ${DAV1D_ASM[@]+"${DAV1D_ASM[@]}"}
case "$TARGET" in
  linux-*) meson_build "$(echo "$ROOT"/openh264-*/)" openh264 -Dtests=disabled ;;
esac

DECODERS=(
  # 视频
  h264 hevc mpeg4 mpeg2video mpeg1video vp8 vp9 av1 msmpeg4v1 msmpeg4v2 msmpeg4v3
  wmv1 wmv2 wmv3 vc1 h263 h263p flv prores mjpeg theora rv30 rv40 dvvideo
  # 音频
  aac aac_latm aac_fixed mp3 mp3float mp2 mp2float mp1 ac3 eac3 dca truehd mlp opus vorbis
  flac alac wmav1 wmav2 wmapro wmavoice amrnb amrwb cook atrac3 ra_144 ra_288
  pcm_s16le pcm_s16be pcm_s24le pcm_s24be pcm_s32le pcm_f32le pcm_u8 pcm_alaw pcm_mulaw adpcm_ima_wav adpcm_ms
)
DEMUXERS=(mov matroska avi flv mpegts mpegps asf ogg mp3 aac ac3 eac3 wav h264 hevc m4v rm dv)
PARSERS=(h264 hevc mpeg4video mpegvideo vp8 vp9 av1 vc1 h263 aac aac_latm ac3 mpegaudio opus vorbis flac dca mlp)
MUXERS=(mp4 mov image2 pcm_s16le null)
ENCODERS=(aac mjpeg pcm_s16le)
FILTERS=(scale fps format aformat aresample null anull setpts asetpts trim atrim copy)
BSFS=(vp9_superframe_split av1_frame_split h264_mp4toannexb hevc_mp4toannexb aac_adtstoasc extract_extradata)

join() { local IFS=,; echo "$*"; }

FLAGS=(
  --disable-everything --disable-autodetect
  --disable-doc --disable-debug --disable-network --disable-ffplay
  --disable-gpl --disable-nonfree
  --enable-ffmpeg --enable-ffprobe
  --enable-swscale --enable-swresample --enable-avfilter
  --enable-protocol=file,pipe
  --enable-decoder="$(join "${DECODERS[@]}")"
  --enable-demuxer="$(join "${DEMUXERS[@]}")"
  --enable-parser="$(join "${PARSERS[@]}")"
  --enable-muxer="$(join "${MUXERS[@]}")"
  --enable-encoder="$(join "${ENCODERS[@]}")"
  --enable-filter="$(join "${FILTERS[@]}")"
  --enable-bsf="$(join "${BSFS[@]}")"
  --enable-libdav1d --enable-decoder=libdav1d
  --pkg-config=pkg-config --pkg-config-flags=--static
  --enable-static --disable-shared
)

case "$TARGET" in
  macos-arm64 | macos-x86_64)
    ARCH=${TARGET#macos-}
    FLAGS+=(
      --enable-videotoolbox --enable-audiotoolbox --enable-encoder=h264_videotoolbox
      --enable-hwaccel=h264_videotoolbox,hevc_videotoolbox
      --enable-zlib
      --arch="$ARCH" --cc="clang -arch $ARCH" --extra-cflags="-mmacosx-version-min=10.15"
      --extra-ldflags="-mmacosx-version-min=10.15"
    )
    if [ "$ARCH" != "$(uname -m)" ]; then FLAGS+=(--enable-cross-compile); fi
    ;;
  linux-x86_64 | linux-arm64)
    FLAGS+=(
      --enable-libopenh264 --enable-encoder=libopenh264 --enable-zlib
      --extra-ldflags="-static-libgcc -static-libstdc++"
      --extra-libs="-lstdc++ -lpthread -lm"
    )
    ;;
  windows-x86_64)
    FLAGS+=(
      --enable-mediafoundation --enable-encoder=h264_mf
      --target-os=mingw32 --arch=x86_64 --cross-prefix=x86_64-w64-mingw32- --enable-cross-compile
      --extra-ldflags="-static -static-libgcc"
    )
    ;;
  *)
    echo "未知目标：$TARGET" >&2
    exit 1
    ;;
esac
# x86 没有 nasm 时不用汇编优化（能编，但转码慢很多；CI 与正式构建都装了 nasm）
case "$TARGET" in
  *x86_64) command -v nasm >/dev/null || FLAGS+=(--disable-x86asm) ;;
esac

BUILD="$OUT/build-$TARGET"
rm -rf "$BUILD" && mkdir -p "$BUILD"
cd "$BUILD"
"$SRC/configure" "${FLAGS[@]}"
make -j"$JOBS"
EXT=""
[ "$TARGET" = windows-x86_64 ] && EXT=".exe"
cp "ffmpeg$EXT" "$OUT/ffmpeg$EXT"
cp "ffprobe$EXT" "$OUT/ffprobe$EXT"
STRIP=strip
[ "$TARGET" = windows-x86_64 ] && STRIP=x86_64-w64-mingw32-strip
"$STRIP" "$OUT/ffmpeg$EXT" "$OUT/ffprobe$EXT" 2>/dev/null || true
ls -la "$OUT/ffmpeg$EXT" "$OUT/ffprobe$EXT"

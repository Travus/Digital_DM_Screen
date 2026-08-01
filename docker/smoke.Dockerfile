# Adds a virtual display and Electron's runtime libraries on top of the build
# image, so the app can be launched headlessly and screenshotted for a smoke
# check. Also carries the SVG rasteriser used to regenerate build/icon.png.
FROM electronuserland/builder:wine

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     xvfb \
     librsvg2-bin \
     icnsutils \
     icoutils \
     libgtk-3-0 \
     libnss3 \
     libasound2 \
     libgbm1 \
     libxss1 \
     libxtst6 \
     libatk-bridge2.0-0 \
     libdrm2 \
     fonts-noto-color-emoji \
  && rm -rf /var/lib/apt/lists/*

# Adds a virtual display and Electron's runtime libraries on top of the build
# image, so the app can be launched headlessly and screenshotted for a smoke
# check. Also carries the SVG rasteriser used to regenerate build/icon.png.
# Pinned, and must stay in step with the `build` service in docker-compose.yml —
# the two share a node_modules volume, so a mismatched node would have them
# trampling each other's installs. Dependabot watches both files.
FROM electronuserland/builder:24-wine-05.26

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

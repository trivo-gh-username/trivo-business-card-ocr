FROM node:20-slim

# tesseract-ocr: the local OCR fallback used only when Gemini is unavailable/erroring.
# curl: used once at build time to fetch the higher-accuracy "best" trained data,
# which is meaningfully more accurate than the "fast" data Debian ships by default.
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr tesseract-ocr-eng curl ca-certificates \
  && TESSDATA_DIR=$(dpkg -L tesseract-ocr-eng | grep tessdata$ ) \
  && curl -fsSL -o "$TESSDATA_DIR/eng.traineddata" \
       https://raw.githubusercontent.com/tesseract-ocr/tessdata_best/main/eng.traineddata \
  && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production
ENV IMAGES_DIR=/data/images

RUN mkdir -p /data/images

EXPOSE 3000
CMD ["node", "src/server.js"]

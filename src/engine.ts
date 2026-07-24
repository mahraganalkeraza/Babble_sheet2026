import jsQR from 'jsqr';
import { CalibrationData, StudentResult, Box } from './types.ts';

// We must declare cv and pdfjsLib since they are loaded via CDN
declare const cv: any;
declare const pdfjsLib: any;

export async function loadPdf(file: File) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  return pdf;
}

export const PDF_RENDER_SCALE = 2.0;

export async function renderPdfPageToCanvas(pdf: any, pageNumber: number, scale = PDF_RENDER_SCALE): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  
  await page.render({
    canvasContext: context,
    viewport: viewport
  }).promise;

  return canvas;
}

export async function processSinglePage(
  canvas: HTMLCanvasElement, 
  calibration: CalibrationData, 
  answerKey: Record<number, string>,
  questionsCount: number,
  columnsCount: number,
  optionsCount: number
): Promise<StudentResult> {
  
  // 1. Perspective Transform using OpenCV
  // Target width/height after warp. Perfect A4 aspect ratio (210mm x 297mm) at high DPI.
  const WARP_W = 2480;
  const WARP_H = 3508;
  
  let srcMat = cv.imread(canvas);
  
  // Points from calibration mapped to [TL, TR, BR, BL]
  let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    calibration.topLeft.x, calibration.topLeft.y,
    calibration.topRight.x, calibration.topRight.y,
    calibration.bottomRight.x, calibration.bottomRight.y,
    calibration.bottomLeft.x, calibration.bottomLeft.y
  ]);
  
  // Perfectly matching A4 corner destination points [TL, TR, BR, BL]
  let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    WARP_W, 0,
    WARP_W, WARP_H,
    0, WARP_H
  ]);
  
  let M = cv.getPerspectiveTransform(srcTri, dstTri);
  let warpedMat = new cv.Mat();
  let dsize = new cv.Size(WARP_W, WARP_H);
  cv.warpPerspective(srcMat, warpedMat, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

  // Helper to map a raw point to the warped space using M
  const mapPoint = (x: number, y: number) => {
    let ptMat = cv.matFromArray(1, 1, cv.CV_32FC2, [x, y]);
    let dstPtMat = new cv.Mat();
    cv.perspectiveTransform(ptMat, dstPtMat, M);
    const dstArr = dstPtMat.data32F;
    const res = { x: dstArr[0], y: dstArr[1] };
    ptMat.delete();
    dstPtMat.delete();
    return res;
  };

  const mapBox = (box: Box) => {
    const tl = mapPoint(box.x, box.y);
    const br = mapPoint(box.x + box.width, box.y + box.height);
    return {
      x: Math.max(0, tl.x),
      y: Math.max(0, tl.y),
      width: Math.min(WARP_W, br.x - tl.x),
      height: Math.min(WARP_H, br.y - tl.y)
    };
  };

  const warpedQrBox = mapBox(calibration.qrBox);
  const warpedOmrBox = mapBox(calibration.omrBox);
  
  // Create a canvas for the warped output explicitly sized
  const warpedCanvas = document.createElement('canvas');
  warpedCanvas.width = WARP_W;
  warpedCanvas.height = WARP_H;
  cv.imshow(warpedCanvas, warpedMat);
  const warpedCtx = warpedCanvas.getContext('2d', { willReadFrequently: true })!;
  
  // Base result
  const result: StudentResult = {
    id: 'ID_Unknown',
    name: '',
    church: '',
    level: '',
    score: 0,
    status: 'success',
    pageImage: warpedCanvas.toDataURL('image/jpeg', 0.5)
  };

  // 2. Decode QR Code
  try {
    const pageWidth = warpedCanvas.width;
    const pageHeight = warpedCanvas.height;

    // We use the perspective-mapped warpedQrBox coordinates for perfect alignment on the warped canvas.
    // We fall back to calibration.qrBox (adjusted for scale) or page percentages to make it extremely robust.
    const scaleFactorX = pageWidth / canvas.width;
    const scaleFactorY = pageHeight / canvas.height;
    
    const qrX = warpedQrBox.x || (calibration.qrBox.x * scaleFactorX) || (pageWidth * 0.02);
    const qrY = warpedQrBox.y || (calibration.qrBox.y * scaleFactorY) || (pageHeight * 0.02);
    const qrW = warpedQrBox.width || (calibration.qrBox.width * scaleFactorX) || (pageWidth * 0.22);
    const qrH = warpedQrBox.height || (calibration.qrBox.height * scaleFactorY) || (pageHeight * 0.18);

    // 1. Calculate expanded bounding box (with safe padding of 50px)
    const pad = 50;
    const safeQrX = Math.max(0, Math.round(qrX - pad)); 
    const safeQrY = Math.max(0, Math.round(qrY - pad));
    const safeQrWidth = Math.min(pageWidth - safeQrX, Math.round(qrW + (pad * 2)));
    const safeQrHeight = Math.min(pageHeight - safeQrY, Math.round(qrH + (pad * 2)));

    // 2. Crop to temporary canvas
    const qrCanvas = document.createElement('canvas');
    qrCanvas.width = safeQrWidth;
    qrCanvas.height = safeQrHeight;
    const qrCtx = qrCanvas.getContext('2d')!;

    qrCtx.drawImage(
      warpedCanvas,
      safeQrX, safeQrY, safeQrWidth, safeQrHeight,
      0, 0, safeQrWidth, safeQrHeight
    );

    // Capture the original un-thresholded image data as a fallback
    const originalQrImageData = qrCtx.getImageData(0, 0, safeQrWidth, safeQrHeight);

    // 3. Apply OpenCV Thresholding for Scanners (grayscale + Otsu's thresholding)
    let src = cv.imread(qrCanvas);
    let dst = new cv.Mat();
    cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY, 0);
    // Apply Otsu's thresholding to get sharp Black & White
    cv.threshold(src, dst, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    cv.imshow(qrCanvas, dst); // Write back to canvas

    // Cleanup memory
    src.delete(); 
    dst.delete();

    // 4. Read with jsQR from Otsu-binarized image data
    const thresholdedQrImageData = qrCtx.getImageData(0, 0, safeQrWidth, safeQrHeight);
    let code = jsQR(thresholdedQrImageData.data, thresholdedQrImageData.width, thresholdedQrImageData.height, {
      inversionAttempts: "attemptBoth", // reads even with shadows/reflections
    });

    // Fallback 1: If binarized fails, try the original crop
    if (!code) {
      code = jsQR(originalQrImageData.data, originalQrImageData.width, originalQrImageData.height, {
        inversionAttempts: "attemptBoth",
      });
    }
    
    // Fallback: If jsQR failed in the expanded calibrated box, scan the entire Top-Left quadrant (TL quadrant)
    if (!code) {
      const tlQx = 0;
      const tlQy = 0;
      const tlQw = Math.floor(pageWidth / 2);
      const tlQh = Math.floor(pageHeight / 2);
      
      let qrRoiTl = new cv.Rect(tlQx, tlQy, tlQw, tlQh);
      let qrMatTl = warpedMat.roi(qrRoiTl);
      
      let blurredTl = new cv.Mat();
      cv.GaussianBlur(qrMatTl, blurredTl, new cv.Size(0, 0), 3);
      let sharpenedTl = new cv.Mat();
      cv.addWeighted(qrMatTl, 1.5, blurredTl, -0.5, 0, sharpenedTl);
      
      const tempCanvasTl = document.createElement('canvas');
      tempCanvasTl.width = tlQw;
      tempCanvasTl.height = tlQh;
      cv.imshow(tempCanvasTl, sharpenedTl);
      const tempCtxTl = tempCanvasTl.getContext('2d', { willReadFrequently: true })!;
      const qrImgDataTl = tempCtxTl.getImageData(0, 0, tlQw, tlQh);
      
      qrMatTl.delete();
      blurredTl.delete();
      sharpenedTl.delete();
      
      code = jsQR(qrImgDataTl.data, qrImgDataTl.width, qrImgDataTl.height, {
        inversionAttempts: "attemptBoth",
      });
    }
    
    if (code) {
      let rawData = code.data || '';
      
      // jsQR sometimes struggles with native UTF-8 Arabic text. 
      // Fortunately it exposes `binaryData` which is the actual byte matrix.
      try {
        if (code.chunks && code.chunks.length > 0) {
          // Decode raw bytes to UTF-8
          rawData = new TextDecoder("utf-8").decode(Uint8Array.from(code.binaryData));
        }
      } catch (e) {
        // Silently fail to standard property
      }

      // Try parsing as JSON first
      try {
        const studentData = JSON.parse(rawData);
        result.id = studentData.id || studentData.Student_ID || rawData;
        
        // n = Name, c = Church, l = Level
        result.name = studentData.n || studentData.name || '';
        result.church = studentData.c || studentData.church || '';
        result.level = studentData.l || studentData.level || studentData.stage || '';
      } catch (e) {
        // Not JSON, fallback to standard delimiters
        if (rawData.includes('-')) {
          const parts = rawData.split('-').map(p => p.trim());
          if (parts.length >= 3) {
              result.id = parts[parts.length - 1] || ''; // The last part is the Unique ID
              result.name = parts[0] || '';              // The first part is the Name
              result.church = parts[1] || '';            // The second part is the Church
              result.level = parts[2] || '';             // The third part is the Level
          } else {
              result.id = rawData;
          }
        } else {
          result.id = rawData; // Just raw ID
        }
      }
    } else {
      result.status = 'failed_qr';
    }
  } catch(e) {
    result.status = 'failed_qr';
    console.error('QR Reading error:', e);
  }

  // 3. OMR Processing
  try {
    const N = questionsCount;
    const cols = columnsCount || 1;
    const rowsPerCol = Math.ceil(N / cols);
    const rowHeight = warpedOmrBox.height / rowsPerCol;
    const colWidth = (warpedOmrBox.width / cols);
    
    // Convert to grayscale & threshold for bubble detection
    let gray = new cv.Mat();
    cv.cvtColor(warpedMat, gray, cv.COLOR_RGBA2GRAY, 0);
    let thresh = new cv.Mat();
    cv.threshold(gray, thresh, 180, 255, cv.THRESH_BINARY_INV);
    
    const tempBinCanvas = document.createElement('canvas');
    tempBinCanvas.width = WARP_W;
    tempBinCanvas.height = WARP_H;
    cv.imshow(tempBinCanvas, thresh);
    const binCtx = tempBinCanvas.getContext('2d', { willReadFrequently: true })!;
    
    // ==========================================
    // 1. TIMING MARKS ISOLATION (THE ANCHORS)
    // ==========================================
    // We crop and scan narrow strips on BOTH sides of the calibrated OMR bounding box 
    // to dynamically locate the physical black timing mark squares.
    const cropY = Math.max(0, warpedOmrBox.y - 150);
    const cropH = Math.min(WARP_H - cropY, warpedOmrBox.height + 300);
    
    const findTimingMarksInStrip = (startX: number, endX: number) => {
      const cropX = Math.max(0, startX);
      const cropW = Math.min(WARP_W - cropX, endX - startX);
      if (cropW <= 0 || cropH <= 0) return [];
      
      const rect = new cv.Rect(cropX, cropY, cropW, cropH);
      const roi = thresh.roi(rect);
      
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(roi, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      
      const candidates: { x: number; y: number; width: number; height: number; area: number }[] = [];
      for (let i = 0; i < contours.size(); ++i) {
        const cnt = contours.get(i);
        const r = cv.boundingRect(cnt);
        const area = cv.contourArea(cnt);
        const boxArea = r.width * r.height;
        const solidity = area / boxArea;
        
        // Timing mark: solid black block (which is inverted to white in thresh)
        if (r.width >= 15 && r.width <= 150 && r.height >= 15 && r.height <= 150) {
          const aspect = Math.min(r.width, r.height) / Math.max(r.width, r.height);
          if (aspect >= 0.35 && solidity > 0.5) {
            candidates.push({
              x: cropX + r.x + r.width / 2,
              y: cropY + r.y + r.height / 2,
              width: r.width,
              height: r.height,
              area: area
            });
          }
        }
      }
      
      roi.delete();
      contours.delete();
      hierarchy.delete();
      
      // Sort candidates from top to bottom
      candidates.sort((a, b) => a.y - b.y);
      
      // Deduplicate close candidates (e.g. nested contours or noise on the same block)
      const uniqueCandidates: typeof candidates = [];
      for (const cand of candidates) {
        if (uniqueCandidates.length === 0) {
          uniqueCandidates.push(cand);
        } else {
          const last = uniqueCandidates[uniqueCandidates.length - 1];
          if (cand.y - last.y < rowHeight * 0.4) {
            if (cand.area > last.area) {
              uniqueCandidates[uniqueCandidates.length - 1] = cand;
            }
          } else {
            uniqueCandidates.push(cand);
          }
        }
      }
      
      return uniqueCandidates;
    };

    const leftStripCandidates = findTimingMarksInStrip(warpedOmrBox.x - 300, warpedOmrBox.x);
    const rightStripCandidates = findTimingMarksInStrip(warpedOmrBox.x + warpedOmrBox.width, warpedOmrBox.x + warpedOmrBox.width + 300);
    
    // Choose whichever side has a candidate count closest to the expected rowsPerCol
    const leftDiff = Math.abs(leftStripCandidates.length - rowsPerCol);
    const rightDiff = Math.abs(rightStripCandidates.length - rowsPerCol);
    
    let selectedCandidates = leftStripCandidates;
    let selectedSide = 'Left';
    
    if (rightDiff < leftDiff) {
      selectedCandidates = rightStripCandidates;
      selectedSide = 'Right';
    }
    
    console.log(`OMR Alignment: Detected timing marks on the ${selectedSide} side. Found ${selectedCandidates.length}/${rowsPerCol} marks.`);

    // ==========================================
    // 2. DYNAMIC ROW MAPPING & INTERPOLATION
    // ==========================================
    const mappedRows: (number | null)[] = Array(rowsPerCol).fill(null);
    for (const cand of selectedCandidates) {
      const r = Math.round(((cand.y - warpedOmrBox.y) / rowHeight) - 0.5);
      if (r >= 0 && r < rowsPerCol) {
        if (mappedRows[r] === null) {
          mappedRows[r] = cand.y;
        } else {
          // Keep the one closer to the estimated center from user-calibration
          const currentEst = warpedOmrBox.y + (r + 0.5) * rowHeight;
          if (Math.abs(cand.y - currentEst) < Math.abs(mappedRows[r]! - currentEst)) {
            mappedRows[r] = cand.y;
          }
        }
      }
    }
    
    // Calculate the median vertical distance (Delta Y) between adjacent detected marks
    const steps: number[] = [];
    let prevIdx = -1;
    for (let r = 0; r < rowsPerCol; r++) {
      if (mappedRows[r] !== null) {
        if (prevIdx !== -1) {
          const step = (mappedRows[r]! - mappedRows[prevIdx]!) / (r - prevIdx);
          steps.push(step);
        }
        prevIdx = r;
      }
    }
    
    const medianDeltaY = steps.length > 0 ? steps.sort((a, b) => a - b)[Math.floor(steps.length / 2)] : rowHeight;
    
    // If no marks were detected at all, initialize the first index with the calibrated baseline
    if (mappedRows.every(v => v === null)) {
      mappedRows[0] = warpedOmrBox.y + rowHeight / 2;
    }
    
    // Propagate backward and forward to fill missing timing marks robustly (Missing Mark Fallback)
    const firstNonNullIdx = mappedRows.findIndex(v => v !== null);
    for (let r = firstNonNullIdx - 1; r >= 0; r--) {
      mappedRows[r] = mappedRows[r + 1]! - medianDeltaY;
    }
    for (let r = firstNonNullIdx + 1; r < rowsPerCol; r++) {
      if (mappedRows[r] === null) {
        mappedRows[r] = mappedRows[r - 1]! + medianDeltaY;
      }
    }

    // ==========================================
    // VISUAL DEBUG: DRAW TRACKED TIMING MARKS
    // ==========================================
    for (let r = 0; r < rowsPerCol; r++) {
      const isDetected = selectedCandidates.some(cand => Math.round(((cand.y - warpedOmrBox.y) / rowHeight) - 0.5) === r);
      const yVal = mappedRows[r]!;
      const xVal = selectedSide === 'Left' ? 
        Math.max(0, warpedOmrBox.x - 120) : 
        Math.min(WARP_W - 80, warpedOmrBox.x + warpedOmrBox.width + 10);
      
      warpedCtx.lineWidth = 4;
      warpedCtx.strokeStyle = isDetected ? '#10b981' : '#f43f5e'; // Green if detected, Rose/Red if interpolated
      warpedCtx.fillStyle = isDetected ? 'rgba(16, 185, 129, 0.1)' : 'rgba(244, 63, 94, 0.1)';
      
      warpedCtx.strokeRect(xVal, yVal - 15, 30, 30);
      warpedCtx.fillRect(xVal, yVal - 15, 30, 30);
      
      warpedCtx.font = "bold 18px monospace";
      warpedCtx.fillStyle = isDetected ? '#047857' : '#be123c';
      warpedCtx.fillText(isDetected ? `[M${r + 1}:DET]` : `[M${r + 1}:INT]`, xVal + (selectedSide === 'Left' ? -170 : 40), yVal + 6);
    }

    // ==========================================
    // 3. GRID PROJECTION & SCORING ARRAY
    // ==========================================
    let totalScore = 0;

    for (let i = 0; i < N; i++) {
      const currentCol = Math.floor(i / rowsPerCol);
      const currentRow = i % rowsPerCol;
      
      const spatialColIdx = cols - 1 - currentCol;
      
      // Calculate original calibrated positions (relative to warpedOmrBox base)
     let qX_calibrated = warpedOmrBox.x + (spatialColIdx * colWidth);

// تحريك العمود الشمال فقط (الأسئلة 11-20) لليسار عشان تبعده عن اليمين
if (spatialColIdx === 0) {
    qX_calibrated -= 80; // جرب اخصم 20 بكسل (تقدر تزود أو تقلل الرقم ده لحد ما يظبط تماماً)
}
      let optWidth_calibrated = colWidth / (optionsCount + 1);
      
      //if (cols === 2) {
        //if (spatialColIdx === 0) {
          // Left column (Questions 11-20)
         // qX_calibrated -= 170; // Original calibrated offset
         // optWidth_calibrated = optWidth_calibrated * 0.98;
      //  } else {
          // Right column (Questions 1-10)
          //qX_calibrated += 20; // Original calibrated offset
         // optWidth_calibrated = optWidth_calibrated * 0.98;
       // }
     // }
      
      // Use the dynamically mapped vertical row Y coordinate centered perfectly
      const Y_r = mappedRows[currentRow]!;
      const bh = rowHeight * 0.8;
      
      let maxDarkness = 0;
      let selectedOption = '';
      let selectedBx = 0, selectedBy = 0, selectedBw = 0, selectedBh = 0;
      let marksCount = 0;
      
      // Arabic characters alphabet sequence
      const arabicLetters = ['أ', 'ب', 'ج', 'د', 'هـ'];
      const options = Array.from({ length: optionsCount }).map((_, idx) => arabicLetters[idx]);      

      for (let o = 0; o < optionsCount; o++) {
        const optChar = options[o];
        const bx_calibrated = qX_calibrated + ((o + 1) * optWidth_calibrated);
        const bw_calibrated = optWidth_calibrated * 0.8;
        
        let bx = bx_calibrated;
        let by = Y_r - bh / 2;
        let bw = bw_calibrated;
        
        // Horizontal Search Tolerance (X-Axis Adaptive Window):
        // Expand search radius around expected X to adjust for any scanner skewing
        let bestDx = 0;
        let bestDxDensity = -1;
        
        for (let dx = -15; dx <= 15; dx++) {
          const testX = Math.max(0, Math.min(WARP_W - 1, bx + dx));
          const testY = Math.max(0, Math.min(WARP_H - 1, by));
          const testW = Math.min(WARP_W - testX, bw);
          const testH = Math.min(WARP_H - testY, bh);
          
          if (testW <= 0 || testH <= 0) continue;
          
          const pixels = binCtx.getImageData(testX, testY, testW, testH).data;
          let whitePixels = 0;
          for (let p = 0; p < pixels.length; p += 4) {
            if (pixels[p] > 128) whitePixels++;
          }
          const density = whitePixels / (testW * testH);
          if (density > bestDxDensity) {
            bestDxDensity = density;
            bestDx = dx;
          }
        }
        
        // Apply horizontal adaptive shift
        bx += bestDx;
        
        // Draw the red visual debug strokes for ALL bubbles (CRITICAL for visual verification)
        warpedCtx.lineWidth = 2;
        warpedCtx.strokeStyle = 'rgba(239, 68, 68, 0.45)'; // Semi-transparent red
        warpedCtx.strokeRect(bx, by, bw, bh);
        
        // Draw a concentric light red debug circle in the bubble
        warpedCtx.beginPath();
        warpedCtx.arc(bx + bw / 2, by + bh / 2, Math.min(bw, bh) * 0.45, 0, 2 * Math.PI);
        warpedCtx.stroke();

        // Analyze final pixel density in the optimized location
        const safeX = Math.max(0, Math.min(WARP_W - 1, bx));
        const safeY = Math.max(0, Math.min(WARP_H - 1, by));
        const safeW = Math.min(WARP_W - safeX, bw);
        const safeH = Math.min(WARP_H - safeY, bh);
        
        const pixels = binCtx.getImageData(safeX, safeY, safeW, safeH).data;
        let whitePixels = 0; 
        for (let p = 0; p < pixels.length; p += 4) {
          if (pixels[p] > 128) whitePixels++;
        }
        
        const density = whitePixels / (safeW * safeH);
        
        if (density > 0.3) { // 30% fill threshold
          marksCount++;
          if (density > maxDarkness) {
            maxDarkness = density;
            selectedOption = optChar;
            selectedBx = safeX;
            selectedBy = safeY;
            selectedBw = safeW;
            selectedBh = safeH;
          }
        } else if (density > maxDarkness && density > 0.15) {
          maxDarkness = density;
          selectedOption = optChar;
          selectedBx = safeX;
          selectedBy = safeY;
          selectedBw = safeW;
          selectedBh = safeH;
        }
      }
      
      const expected = answerKey[i + 1];
      const isCorrect = expected && selectedOption === expected;
      
      if (isCorrect) {
        totalScore++;
      }
      
      let diagnosticMsg = '';
      if (marksCount === 0) {
          if (selectedOption !== '') {
             diagnosticMsg = `[Weak Shading Warning]`;
          } else {
             diagnosticMsg = `[Blank - No Mark Detected]`;
          }
      } else if (marksCount > 1) {
          diagnosticMsg = `[Double Mark - Resolved to ${selectedOption}]`;
      }

      // Apply visual overlays onto the ORIGINAL warpedCtx
      if (selectedOption !== '') {
          warpedCtx.lineWidth = 6;
          if (expected) {
              if (isCorrect) {
                  warpedCtx.strokeStyle = '#22c55e'; // Green
                  warpedCtx.strokeRect(selectedBx, selectedBy, selectedBw, selectedBh);
              } else {
                  warpedCtx.strokeStyle = '#ef4444'; // Red
                  // Draw X
                  warpedCtx.beginPath();
                  warpedCtx.moveTo(selectedBx, selectedBy);
                  warpedCtx.lineTo(selectedBx + selectedBw, selectedBy + selectedBh);
                  warpedCtx.moveTo(selectedBx + selectedBw, selectedBy);
                  warpedCtx.lineTo(selectedBx, selectedBy + selectedBh);
                  warpedCtx.stroke();
                  warpedCtx.strokeRect(selectedBx, selectedBy, selectedBw, selectedBh);
              }
          } else {
              warpedCtx.strokeStyle = '#3b82f6'; // Blue
              warpedCtx.strokeRect(selectedBx, selectedBy, selectedBw, selectedBh);
          }
      }

      if (diagnosticMsg) {
          warpedCtx.font = "bold 48px monospace";
          warpedCtx.fillStyle = "#ef4444";
          // Render diagnostic message slightly shifted from the row point
          const labelX = qX_calibrated + (optionsCount + 1) * optWidth_calibrated + 20; 
          warpedCtx.fillText(diagnosticMsg, labelX, Y_r + bh / 2 - 10);
      }
    }
    
    result.score = totalScore;
    
    // Capture annotated image
    result.pageImage = warpedCanvas.toDataURL('image/jpeg', 0.5);
    
    gray.delete();
    thresh.delete();

  } catch(e) {
    console.error("OMR Failed", e);
    result.status = result.status === 'failed_qr' ? 'needs_review' : 'failed_omr';
  }
  
  // Cleanup
  srcMat.delete();
  srcTri.delete();
  dstTri.delete();
  M.delete();
  warpedMat.delete();
  
  return result;
}

export const WARPED_W = 2480;
export const WARPED_H = 3508;

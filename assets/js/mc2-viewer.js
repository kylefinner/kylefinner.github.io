(function () {
  const INDEX_URL = "assets/data/mc2_tiles_index.json";
  const ENABLE_WCS_TOOLS = new URLSearchParams(window.location.search).get("wcs") === "1";

  const clusterSelect = document.getElementById("clusterSelect");
  const statusText = document.getElementById("statusText");
  const clusterName = document.getElementById("clusterName");
  const clusterDescription = document.getElementById("clusterDescription");
  const metaList = document.getElementById("metaList");
  const homeBtn = document.getElementById("homeBtn");
  const contourSvg = document.getElementById("contourSvg");
  const controlsUnavailable = document.getElementById("controlsUnavailable");
  const controlsActive = document.getElementById("controlsActive");
  const raInput = document.getElementById("raInput");
  const decInput = document.getElementById("decInput");
  const gotoBtn = document.getElementById("gotoBtn");
  const clearBtn = document.getElementById("clearBtn");
  const contourLowerInput = document.getElementById("contourLower");
  const contourUpperInput = document.getElementById("contourUpper");
  const contourCountInput = document.getElementById("contourCount");
  const contourColorInput = document.getElementById("contourColor");
  const loadContoursBtn = document.getElementById("loadContoursBtn");
  const clearContoursBtn = document.getElementById("clearContoursBtn");

  let viewer = null;
  let clusterMap = new Map();
  let currentCluster = null;
  let currentMeta = null;
  let backendAvailable = false;
  let markerElement = null;
  let contourData = null;
  let currentContourColor = "#00ffff";

  function prettifyClusterName(clusterId) {
    const label = clusterId.replace(/^1rxsj0603$/i, "Toothbrush Cluster");
    return label
      .replace(/^cizaj2242$/i, "Sausage Cluster")
      .replace(/^macsj/i, "MACS J")
      .replace(/^plckg/i, "PLCK G")
      .replace(/^rxcj/i, "RXC J")
      .replace(/^zwcl/i, "ZwCl ")
      .replace(/^abell/i, "Abell ")
      .replace(/(\D)(\d{4})$/, "$1$2");
  }

  function describeCluster(record) {
    return "Optical color mosaic; coordinates and dimensions follow the tile index.";
  }

  function setStatus(message, isError) {
    statusText.textContent = message;
    statusText.style.color = isError ? "#ffb0b0" : "";
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, options || {});
    if (!response.ok) {
      let detail = "Request failed";
      try {
        const data = await response.json();
        detail = data.detail || detail;
      } catch (error) {
        detail = `${detail} (${response.status})`;
      }
      throw new Error(detail);
    }
    return response.json();
  }

  function tileSourceFromRecord(record) {
    return {
      width: record.width,
      height: record.height,
      tileSize: record.tile_size,
      minLevel: 0,
      maxLevel: record.max_level,
      getTileUrl(level, x, y) {
        return record.tile_url_template
          .replace("{z}", String(level))
          .replace("{x}", String(x))
          .replace("{y}", String(y));
      }
    };
  }

  function renderMeta(record) {
    clusterName.textContent = prettifyClusterName(record.cluster);
    clusterDescription.textContent = describeCluster(record);

    const items = [
      `<li><strong>Image size:</strong> ${record.width.toLocaleString()} x ${record.height.toLocaleString()} px</li>`,
      `<li><strong>Tile size:</strong> ${record.tile_size}px</li>`,
      `<li><strong>Zoom levels:</strong> ${record.max_level + 1}</li>`,
      `<li><strong>Total tiles:</strong> ${record.total_tiles.toLocaleString()}</li>`
    ];

    metaList.innerHTML = items.join("");
  }

  function clearMarker() {
    if (markerElement && viewer) {
      viewer.removeOverlay(markerElement);
      markerElement.remove();
      markerElement = null;
    }
  }

  function placeMarkerAtImagePoint(x, y) {
    clearMarker();
    const div = document.createElement("div");
    div.style.width = "18px";
    div.style.height = "18px";
    div.style.marginLeft = "-9px";
    div.style.marginTop = "-9px";
    div.style.border = "2px solid #ff6b6b";
    div.style.borderRadius = "50%";
    div.style.boxShadow = "0 0 10px rgba(255,107,107,0.9)";
    viewer.addOverlay({
      element: div,
      location: new OpenSeadragon.Rect(x, y, 0, 0),
      placement: OpenSeadragon.Placement.CENTER
    });
    markerElement = div;
  }

  function clearContours() {
    contourData = null;
    while (contourSvg.firstChild) {
      contourSvg.removeChild(contourSvg.firstChild);
    }
    contourSvg.setAttribute("width", "0");
    contourSvg.setAttribute("height", "0");
  }

  function redrawContours() {
    while (contourSvg.firstChild) {
      contourSvg.removeChild(contourSvg.firstChild);
    }

    if (!viewer || !contourData) {
      contourSvg.setAttribute("width", "0");
      contourSvg.setAttribute("height", "0");
      return;
    }

    const containerSize = viewer.viewport.getContainerSize();
    contourSvg.setAttribute("width", String(containerSize.x));
    contourSvg.setAttribute("height", String(containerSize.y));
    contourSvg.setAttribute("viewBox", `0 0 ${containerSize.x} ${containerSize.y}`);

    contourData.forEach(function (levelItem) {
      levelItem.segments.forEach(function (seg) {
        if (!seg || seg.length < 2) {
          return;
        }
        const pts = seg.map(function (p) {
          const imgPoint = new OpenSeadragon.Point(p[0], p[1]);
          const vpPoint = viewer.viewport.imageToViewportCoordinates(imgPoint);
          const pxPoint = viewer.viewport.pixelFromPoint(vpPoint, true);
          return `${pxPoint.x},${pxPoint.y}`;
        });

        const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        poly.setAttribute("points", pts.join(" "));
        poly.setAttribute("fill", "none");
        poly.setAttribute("stroke", currentContourColor);
        poly.setAttribute("stroke-width", "2");
        poly.setAttribute("vector-effect", "non-scaling-stroke");
        poly.setAttribute("stroke-linejoin", "round");
        poly.setAttribute("stroke-linecap", "round");
        poly.setAttribute("opacity", "0.95");
        contourSvg.appendChild(poly);
      });
    });
  }

  async function detectBackend() {
    if (!ENABLE_WCS_TOOLS) {
      backendAvailable = false;
      controlsUnavailable.hidden = false;
      controlsActive.hidden = true;
      return;
    }

    try {
      await fetchJson("/api/clusters");
      backendAvailable = true;
      controlsUnavailable.hidden = true;
      controlsActive.hidden = false;
    } catch (error) {
      backendAvailable = false;
      controlsUnavailable.hidden = false;
      controlsActive.hidden = true;
    }
  }

  function loadCluster(clusterId) {
    const record = clusterMap.get(clusterId);
    if (!record) {
      setStatus(`Cluster not found: ${clusterId}`, true);
      return;
    }

    currentCluster = clusterId;
    renderMeta(record);
    setStatus(`Loading image: ${prettifyClusterName(clusterId)}`);
    clearMarker();
    clearContours();

    const tileSource = tileSourceFromRecord(record);

    if (viewer.world.getItemCount() > 0) {
      viewer.world.removeAll();
    }

    viewer.addTiledImage({
      tileSource,
      success() {
        viewer.viewport.goHome(true);
        setStatus(`Current image: ${prettifyClusterName(clusterId)}`);
        if (backendAvailable) {
          fetchJson(`/api/images/${encodeURIComponent(clusterId)}/meta`).then(function (meta) {
            currentMeta = meta;
            if (meta.mass_stats) {
              contourLowerInput.value = meta.mass_stats.p75;
              contourUpperInput.value = meta.mass_stats.p95;
            } else {
              contourLowerInput.value = "";
              contourUpperInput.value = "";
            }
          }).catch(function (error) {
            setStatus(error.message, true);
          });
        }
      },
      error(event) {
        const message = event && event.message ? event.message : "Unable to load tiled image.";
        setStatus(message, true);
      }
    });

    const url = new URL(window.location.href);
    url.searchParams.set("cluster", clusterId);
    window.history.replaceState({}, "", url);
  }

  async function init() {
    viewer = OpenSeadragon({
      id: "viewer",
      prefixUrl: "https://cdnjs.cloudflare.com/ajax/libs/openseadragon/4.1.0/images/",
      showNavigator: true,
      navigatorPosition: "BOTTOM_RIGHT",
      visibilityRatio: 1,
      constrainDuringPan: true,
      blendTime: 0.12,
      animationTime: 0.9,
      maxZoomPixelRatio: 2.2,
      minZoomImageRatio: 0.7
    });
    viewer.addHandler("animation", redrawContours);
    viewer.addHandler("resize", redrawContours);
    viewer.addHandler("update-viewport", redrawContours);

    homeBtn.addEventListener("click", function () {
      if (viewer) {
        viewer.viewport.goHome(true);
      }
    });

    clusterSelect.addEventListener("change", function () {
      loadCluster(clusterSelect.value);
    });

    gotoBtn.addEventListener("click", async function () {
      const ra = parseFloat(raInput.value);
      const dec = parseFloat(decInput.value);
      if (!backendAvailable) {
        setStatus("WCS service unavailable.", true);
        return;
      }
      if (!Number.isFinite(ra) || !Number.isFinite(dec)) {
        setStatus("RA and Dec must be numeric values in degrees.", true);
        return;
      }
      try {
        const pixel = await fetchJson(`/api/images/${encodeURIComponent(currentCluster)}/sky-to-pixel?ra=${encodeURIComponent(ra)}&dec=${encodeURIComponent(dec)}`);
        if (!pixel.on_image) {
          setStatus(`RA/Dec maps outside the image: x=${pixel.x.toFixed(1)}, y=${pixel.y.toFixed(1)}.`, true);
          return;
        }
        const point = new OpenSeadragon.Point(pixel.x, pixel.y);
        const vpPoint = viewer.viewport.imageToViewportCoordinates(point);
        viewer.viewport.panTo(vpPoint);
        viewer.viewport.zoomTo(Math.max(viewer.viewport.getZoom(), 1.5));
        placeMarkerAtImagePoint(pixel.x, pixel.y);
        setStatus(`Position set: RA=${ra.toFixed(6)}, Dec=${dec.toFixed(6)}.`);
      } catch (error) {
        setStatus(error.message, true);
      }
    });

    clearBtn.addEventListener("click", function () {
      clearMarker();
      setStatus("Position marker cleared.");
    });

    loadContoursBtn.addEventListener("click", async function () {
      const lower = parseFloat(contourLowerInput.value);
      const upper = parseFloat(contourUpperInput.value);
      const count = parseInt(contourCountInput.value, 10);
      if (!backendAvailable) {
        setStatus("Contour service unavailable.", true);
        return;
      }
      if (!Number.isFinite(lower) || !Number.isFinite(upper) || !Number.isFinite(count)) {
        setStatus("Contour lower bound, upper bound, and count must be numeric.", true);
        return;
      }
      try {
        currentContourColor = contourColorInput.value || "#00ffff";
        setStatus("Computing contours...");
        const result = await fetchJson(`/api/images/${encodeURIComponent(currentCluster)}/mass-contours?lower=${encodeURIComponent(lower)}&upper=${encodeURIComponent(upper)}&n_contours=${encodeURIComponent(count)}`);
        contourData = result.contours;
        redrawContours();
        setStatus(`Displayed ${result.n_contours} contour levels.`);
      } catch (error) {
        setStatus(error.message, true);
      }
    });

    clearContoursBtn.addEventListener("click", function () {
      clearContours();
      setStatus("Contour layer cleared.");
    });

    try {
      await detectBackend();
      const response = await fetch(INDEX_URL);
      if (!response.ok) {
        throw new Error(`Failed to load ${INDEX_URL} (${response.status})`);
      }

      const data = await response.json();
      const clusters = Array.isArray(data.clusters) ? data.clusters.slice() : [];

      clusters.sort(function (a, b) {
        return a.cluster.localeCompare(b.cluster);
      });

      clusterMap = new Map(clusters.map(function (record) {
        return [record.cluster, record];
      }));

      clusterSelect.innerHTML = clusters.map(function (record) {
        return `<option value="${record.cluster}">${prettifyClusterName(record.cluster)}</option>`;
      }).join("");

      const selected = new URLSearchParams(window.location.search).get("cluster");
      const initialCluster = clusterMap.has(selected) ? selected : clusters[0].cluster;
      clusterSelect.value = initialCluster;
      loadCluster(initialCluster);
    } catch (error) {
      setStatus(error.message, true);
      clusterName.textContent = "Image archive unavailable";
      clusterDescription.textContent = "The tile index could not be loaded.";
      metaList.innerHTML = "";
    }
  }

  init();
})();

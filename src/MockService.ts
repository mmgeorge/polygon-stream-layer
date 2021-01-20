interface Feature<T> {
  attributes: { [key: string]: string | number },
  geometry: T;
}


interface PointFeature {
  attributes: { [key: string]: string | number },
  geometry: {
    x: number,
    y: number;
  }
}

interface PolygonFeature {
  attributes: { [key: string]: string | number },
  geometry: {
    rings: number[][][]
  }
}

export interface Polyline {
  paths: number[][][];
}

export interface FeatureSet<T> {
  features: Feature<T>[];
}

export interface MockServiceConfig {
  trackedAssets: number,
  pageSize: number,
  distStep: number
}


/** 
 * MockService that will output either point or polygon features with a geometry and 
 * two attributes - a TRACKID and OBJECTID
 */
export class MockService {
  constructor(config: Partial<MockServiceConfig>) {
    this._config = {...MockService._defaults(), ...config }
  };

  private static _defaults(): MockServiceConfig {
    return {
      trackedAssets: 50000, // number of points
      pageSize: 10000,       // how many points to update in one cycle
      distStep: 0.05 * 2    // speed
    }
  }

  private _idCounter = 0x1;
  private _page = 0;
  private _config: MockServiceConfig
  private _lastObservations: PointFeature[] = [];
  private _vertexPositions: number[] = []
  private _polylines: FeatureSet<Polyline>

  initialize(polylines: FeatureSet<Polyline>): void {
    this._polylines = polylines;
    this._initialize(polylines);
  }

  next(): string {
    const polylines = this._polylines;
    const { pageSize, trackedAssets } = this._config;
    const start = this._nextPage() * pageSize;
    const end = Math.min(start + pageSize, trackedAssets);
    const outFeatures: (PointFeature | PolygonFeature)[] = new Array<PointFeature | PolygonFeature>(end - start);
    
    if (start === 0) {
      this._updatePositions(polylines);
    }
    
    const lastObservations = this._lastObservations;
    for (let i = start; i < end; i++) {
      outFeatures[i] = lastObservations[i];
    }

    return JSON.stringify({
      type: "featureResult",
      features: outFeatures
    });
  }

  private _initialize(polylines: FeatureSet<Polyline>): void {
    const vertexPositions = this._vertexPositions;
    const config = this._config;
    const numOfTrackedAssets = Math.min(config.trackedAssets, polylines.features.length);

    let heading: number;
    for (let i = 0; i < numOfTrackedAssets; i++) {
      const feature = polylines.features[i];
      const path = feature.geometry.paths[0];
      if (path.length < 2) {
        continue;
      }

      const vertex = path[0];
      const vertexNext = path[1];
      const x0 = vertex[0];
      const y0 = vertex[1];
      const x1 = vertexNext[0];
      const y1 = vertexNext[1];
      const dist = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
      const speed = dist / config.distStep;
            
      vertexPositions.push(
        i, // feature index 
        0, // current vertex index
        dist, // distance to the next vertex 
        0, // accumulated distance (to the next vertex)
        speed // speed
        );
      
      this._lastObservations.push({
        attributes: {
          OBJECTID: this._createId(),
          TRACKID: i / 4,
          HEADING: getAzimuth(x1 - x0, y1 - y0),
          TYPE: Math.round(Math.random() * 5)
        },
        geometry: { x: x0, y: y0 }
      })
    }
  }

  private _sumPolylineVertices(polylines: FeatureSet<Polyline>): number {
    let sum = 0;
    
    for (const feature of polylines.features) {
      const paths = feature.geometry.paths;

      for (const path of paths) {
        sum += path.length;
      }
    }

    return sum;
  }

  private _updatePositions(polylines: FeatureSet<Polyline>): void {
    const vertexPositions = this._vertexPositions;    
    for (let i = 0; i < vertexPositions.length; i += 5) {
      const featureIndex = vertexPositions[i];
      let vertexIndex = vertexPositions[i + 1];
      let distanceToNextVertex = vertexPositions[i + 2];
      let accumulatedDistance = vertexPositions[i + 3];
      let speed = vertexPositions[i + 4];

      
      const path = polylines.features[featureIndex].geometry.paths[0];
      let vertex = path[vertexIndex];
      let vertexNext = path[vertexIndex + 1];
      let x0 = vertex[0];
      let y0 = vertex[1];
      let x1 = vertexNext[0];
      let y1 = vertexNext[1];      
      const index = i / 5;

      let nextDist = accumulatedDistance + speed;
      const distanceRatio = nextDist / distanceToNextVertex;
      const x = x0 + (x1 - x0) * distanceRatio;
      const y = y0 + (y1 - y0) * distanceRatio;
      
      const geometry = this._lastObservations[index].geometry;
      const attributes = this._lastObservations[index].attributes;

      attributes.OBJECTID = this._createId(); // New observation needs new oid
      attributes.HEADING = getAzimuth(x1 - x0, y1 - y0);
      
      geometry.x = x;
      geometry.y = y;

      vertexPositions[i + 3] = nextDist
      
      // test if we need to move to the next vertex
      if (nextDist + speed >= distanceToNextVertex) {
        
        vertexIndex++;

        // If we reach the end, loop back ground
        if (vertexIndex >= (path.length - 1))  {
          vertexIndex = 0;
        }

        vertex = path[0];
        vertexNext = path[1];
        x0 = vertex[0];
        y0 = vertex[1];
        x1 = vertexNext[0];
        y1 = vertexNext[1];
        const dist = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
        speed = dist / this._config.distStep;

        vertexPositions[i + 1] = vertexIndex;
        vertexPositions[i + 2] = dist;
        vertexPositions[i + 3] = 0;
        vertexPositions[i + 4] = speed;
      }
    }
  }

  private _nextPage (): number {
    this._page++;
    
    const maxPage = Math.ceil(this._config.trackedAssets / this._config.pageSize);

    if (this._page >= maxPage) {
      this._page = 0;
    }

    return this._page;
  }

  private _createId(): number {
    const id = this._idCounter;
    
    this._idCounter = ((this._idCounter + 1) % 0xfffffffe); // force nonzero u32
    return id;
  }
}

function getAzimuth(dx: number, dy: number): number {
  return Math.atan2(dy, dx) - Math.PI / 2;
}



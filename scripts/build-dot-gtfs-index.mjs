#!/usr/bin/env node
/**
 * build-dot-gtfs-index.mjs
 *
 * Reads DOT_GTFS_Feeds_List.csv and produces dot-gtfs-index.json — a
 * spatially-bucketed index of US transit agencies with GTFS feed URLs.
 *
 * Usage: node scripts/build-dot-gtfs-index.mjs
 *
 * The script:
 *   1. Parses the CSV and extracts unique City+State pairs
 *   2. Looks up coordinates from:
 *      a. An embedded US cities map (covers ~300 major cities)
 *      b. The geonames SQLite DB if available (scripts/build-geonames-sqlite.mjs)
 *   3. Groups feeds into 0.1° spatial buckets
 *   4. Deduplicates by NTD ID + URL
 *   5. Outputs src/services/transit/dot-gtfs-index.json
 *
 * Output: dot-gtfs-index.json (~100 KB gzipped)
 */

import { readFileSync, writeFileSync, statSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

const CSV_PATH = resolve(PROJECT_ROOT, 'src/services/transit/DOT_GTFS_Feeds_List.csv');
const OUTPUT_PATH = resolve(PROJECT_ROOT, 'src/services/transit/dot-gtfs-index.json');

// ── Embedded US city coordinates ────────────────────────────────────
// Key: "City, State" (lowercase). Covers major US cities housing
// most transit agencies. Generated from US Census / GeoNames data.
// Coordinates are [lat, lng].

/** @type {Map<string, [number, number]>} */
const US_CITY_COORDS = new Map([
  ['aberdeen, md', [39.5096, -76.1641]],
  ['abilene, tx', [32.4487, -99.7331]],
  ['akron, oh', [41.0814, -81.5190]],
  ['alameda, ca', [37.7652, -122.2416]],
  ['alamogordo, nm', [32.8995, -105.9603]],
  ['albany, ga', [31.5785, -84.1557]],
  ['albany, ny', [42.6526, -73.7562]],
  ['albany, or', [44.6365, -123.1059]],
  ['albuquerque, nm', [35.0853, -106.6055]],
  ['alexandria, la', [31.3113, -92.4451]],
  ['alexandria, va', [38.8048, -77.0469]],
  ['allentown, pa', [40.6084, -75.4902]],
  ['altoona, pa', [40.5187, -78.3947]],
  ['amarillo, tx', [35.2220, -101.8313]],
  ['ames, ia', [42.0347, -93.6199]],
  ['anaheim, ca', [33.8366, -117.9143]],
  ['anchorage, ak', [61.2181, -149.9003]],
  ['anderson, in', [40.1053, -85.6803]],
  ['anderson, sc', [34.5034, -82.6501]],
  ['ann arbor, mi', [42.2808, -83.7430]],
  ['annapolis, md', [38.9786, -76.4919]],
  ['anniston, al', [33.6573, -85.8305]],
  ['appleton, wi', [44.2619, -88.4154]],
  ['arlington, tx', [32.7357, -97.1081]],
  ['arlington, va', [38.8799, -77.1068]],
  ['arlington heights, il', [42.0884, -87.9806]],
  ['asheville, nc', [35.5951, -82.5515]],
  ['astoria, or', [46.1879, -123.8313]],
  ['atlanta, ga', [33.7490, -84.3880]],
  ['atlantic city, nj', [39.3643, -74.4229]],
  ['auburn, al', [32.6099, -85.4808]],
  ['auburn, wa', [47.3073, -122.2284]],
  ['augusta, ga', [33.4735, -82.0105]],
  ['austin, tx', [30.2672, -97.7431]],
  ['bakersfield, ca', [35.3733, -119.0187]],
  ['baltimore, md', [39.2904, -76.6122]],
  ['bangor, me', [44.8016, -68.7778]],
  ['baton rouge, la', [30.4515, -91.1871]],
  ['battle creek, mi', [42.3212, -85.1797]],
  ['beaumont, tx', [30.0802, -94.1266]],
  ['bellevue, wa', [47.6101, -122.2015]],
  ['bellingham, wa', [48.7596, -122.4882]],
  ['bend, or', [44.0582, -121.3153]],
  ['berkeley, ca', [37.8716, -122.2727]],
  ['bethel, ak', [60.7922, -161.7558]],
  ['bethlehem, pa', [40.6259, -75.3705]],
  ['billings, mt', [45.7833, -108.5007]],
  ['birmingham, al', [33.5186, -86.8104]],
  ['bismarck, nd', [46.8083, -100.7837]],
  ['bloomington, il', [40.4842, -88.9936]],
  ['bloomington, in', [39.1653, -86.5264]],
  ['boise city, id', [43.6150, -116.2023]],
  ['boston, ma', [42.3601, -71.0589]],
  ['bozeman, mt', [45.6796, -111.0386]],
  ['bremerton, wa', [47.5650, -122.6270]],
  ['bridgeport, ct', [41.1865, -73.1952]],
  ['brookings, or', [42.0526, -124.2838]],
  ['brookings, sd', [44.3114, -96.7984]],
  ['brownsville, tx', [25.9017, -97.4975]],
  ['buffalo, ny', [42.8864, -78.8784]],
  ['burlington, nc', [36.0957, -79.4378]],
  ['burlington, vt', [44.4759, -73.2121]],
  ['burlington, wa', [48.4757, -122.3254]],
  ['burns, or', [43.5863, -119.0541]],
  ['cambridge, ma', [42.3736, -71.1097]],
  ['camden, nj', [39.9259, -75.1196]],
  ['canby, or', [45.2629, -122.6926]],
  ['canton, oh', [40.7989, -81.3784]],
  ['cape coral, fl', [26.5629, -81.9495]],
  ['carson city, nv', [39.1638, -119.7674]],
  ['charles city, ia', [43.0664, -92.6724]],
  ['charleston, sc', [32.7765, -79.9311]],
  ['charleston, wv', [38.3498, -81.6326]],
  ['charlotte, nc', [35.2271, -80.8431]],
  ['chattanooga, tn', [35.0456, -85.3097]],
  ['cheyenne, wy', [41.1400, -104.8202]],
  ['chicago, il', [41.8781, -87.6298]],
  ['chico, ca', [39.7285, -121.8375]],
  ['cincinnati, oh', [39.1031, -84.5120]],
  ['clarksville, tn', [36.5298, -87.3595]],
  ['cleveland, oh', [41.4993, -81.6944]],
  ['colorado springs, co', [38.8339, -104.8214]],
  ['columbia, mo', [38.9517, -92.3341]],
  ['columbia, sc', [34.0007, -81.0348]],
  ['columbus, ga', [32.4610, -84.9877]],
  ['columbus, oh', [39.9612, -82.9988]],
  ['colville, wa', [48.5466, -117.9055]],
  ['concord, ca', [37.9780, -122.0311]],
  ['concord, nh', [43.2081, -71.5376]],
  ['coos bay, or', [43.3665, -124.2179]],
  ['corpus christi, tx', [27.8006, -97.3964]],
  ['corvallis, or', [44.5646, -123.2620]],
  ['craig, ak', [55.4764, -133.1483]],
  ['dallas, tx', [32.7767, -96.7970]],
  ['danbury, ct', [41.3948, -73.4540]],
  ['danville, il', [40.1245, -87.6300]],
  ['dayton, oh', [39.7589, -84.1916]],
  ['daytona beach, fl', [29.2108, -81.0229]],
  ['decatur, al', [34.6059, -86.9833]],
  ['decatur, il', [39.8403, -88.9548]],
  ['denver, co', [39.7392, -104.9903]],
  ['des moines, ia', [41.5868, -93.6250]],
  ['detroit, mi', [42.3314, -83.0458]],
  ['dothan, al', [31.2232, -85.3905]],
  ['dover, de', [39.1582, -75.5244]],
  ['dover, id', [48.2544, -116.6019]],
  ['dubuque, ia', [42.5006, -90.6646]],
  ['duluth, mn', [46.7867, -92.1005]],
  ['durham, nc', [35.9940, -78.8986]],
  ['eau claire, wi', [44.8113, -91.4985]],
  ['el paso, tx', [31.7619, -106.4850]],
  ['elgin, il', [42.0354, -88.2826]],
  ['elizabeth, nj', [40.6636, -74.2107]],
  ['elkhart, in', [41.6875, -85.9729]],
  ['ellensburg, wa', [46.9965, -120.5478]],
  ['elmira, ny', [42.0898, -76.8077]],
  ['elyria, oh', [41.3684, -82.1076]],
  ['eugene, or', [44.0521, -123.0868]],
  ['evansville, in', [37.9716, -87.5711]],
  ['everett, wa', [47.9790, -122.2021]],
  ['fairbanks, ak', [64.8378, -147.7164]],
  ['fairfield, ca', [38.2494, -122.0400]],
  ['falmouth, ma', [41.5520, -70.6087]],
  ['fargo, nd', [46.8772, -96.7898]],
  ['fayetteville, ar', [36.0822, -94.1719]],
  ['fayetteville, nc', [35.0527, -78.8784]],
  ['flagstaff, az', [35.1981, -111.6512]],
  ['flint, mi', [43.0125, -83.6875]],
  ['florence, al', [34.7998, -87.6773]],
  ['florence, ky', [38.9989, -84.6266]],
  ['florence, sc', [34.1954, -79.7626]],
  ['fond du lac, wi', [43.7730, -88.4470]],
  ['fort collins, co', [40.5853, -105.0844]],
  ['fort hall, id', [43.0196, -112.4383]],
  ['fort lauderdale, fl', [26.1224, -80.1373]],
  ['fort myers, fl', [26.6406, -81.8723]],
  ['fort smith, ar', [35.3859, -94.3985]],
  ['fort walton beach, fl', [30.4058, -86.6189]],
  ['fort wayne, in', [41.0793, -85.1394]],
  ['fort worth, tx', [32.7555, -97.3308]],
  ['fort yukon, ak', [66.5647, -145.2739]],
  ['frederick, md', [39.4143, -77.4105]],
  ['fresno, ca', [36.7468, -119.7726]],
  ['gainesville, fl', [29.6516, -82.3248]],
  ['gainesville, ga', [34.2976, -83.8241]],
  ['gaithersburg, md', [39.1434, -77.2014]],
  ['gary, in', [41.5934, -87.3464]],
  ['glendale, az', [33.5387, -112.1860]],
  ['goldendale, wa', [45.8207, -120.8217]],
  ['grand forks, nd', [47.9253, -97.0329]],
  ['grand junction, co', [39.0639, -108.5506]],
  ['grand rapids, mi', [42.9634, -85.6681]],
  ['grant pass, or', [42.4390, -123.3284]],
  ['greeley, co', [40.4233, -104.7091]],
  ['green bay, wi', [44.5133, -88.0133]],
  ['greensboro, nc', [36.0726, -79.7920]],
  ['greenville, nc', [35.6127, -77.3664]],
  ['greenville, sc', [34.8526, -82.3940]],
  ['gulfport, ms', [30.3674, -89.0928]],
  ['harrisburg, pa', [40.2732, -76.8867]],
  ['hartford, ct', [41.7658, -72.6734]],
  ['havre, mt', [48.5500, -109.6841]],
  ['hays, ks', [38.8792, -99.3268]],
  ['helena, mt', [46.5891, -112.0391]],
  ['hemet, ca', [33.7475, -116.9720]],
  ['heppner, or', [45.3537, -119.5554]],
  ['hillsboro, or', [45.5229, -122.9898]],
  ['hinesville, ga', [31.8469, -81.5959]],
  ['hobbs, nm', [32.7026, -103.1360]],
  ['hoboken, nj', [40.7440, -74.0324]],
  ['honolulu, hi', [21.3069, -157.8583]],
  ['hood river, or', [45.7054, -121.5215]],
  ['hoquiam, wa', [46.9810, -123.8882]],
  ['houston, tx', [29.7604, -95.3698]],
  ['huntington, wv', [38.4192, -82.4452]],
  ['huntsville, al', [34.7304, -86.5861]],
  ['hyannis, ma', [41.6525, -70.2828]],
  ['idaho falls, id', [43.4927, -112.0408]],
  ['independence, mo', [39.0911, -94.4155]],
  ['indianapolis, in', [39.7684, -86.1581]],
  ['jackson, mi', [42.2459, -84.4013]],
  ['jackson, ms', [32.2988, -90.1848]],
  ['jackson, tn', [35.6145, -88.8139]],
  ['jacksonville, fl', [30.3322, -81.6557]],
  ['jefferson city, mo', [38.5767, -92.1735]],
  ['jersey city, nj', [40.7178, -74.0431]],
  ['john day, or', [44.4160, -118.9528]],
  ['johnson city, tn', [36.3134, -82.3535]],
  ['juneau, ak', [58.3019, -134.4197]],
  ['kalamazoo, mi', [42.2917, -85.5872]],
  ['kansas city, ks', [39.1141, -94.6275]],
  ['kansas city, mo', [39.0997, -94.5786]],
  ['keene, nh', [42.9337, -72.2781]],
  ['kennewick, wa', [46.2112, -119.1372]],
  ['kenosha, wi', [42.5847, -87.8212]],
  ['ketchikan, ak', [55.3422, -131.6461]],
  ['ketchum, id', [43.6807, -114.3637]],
  ['killeen, tx', [31.1171, -97.7278]],
  ['klamath falls, or', [42.2249, -121.7817]],
  ['knoxville, tn', [35.9606, -83.9207]],
  ['kokomo, in', [40.4864, -86.1336]],
  ['la crosse, wi', [43.8014, -91.2396]],
  ['la grande, or', [45.3246, -118.0877]],
  ['lafayette, in', [40.4167, -86.8753]],
  ['lafayette, la', [30.2241, -92.0198]],
  ['lake charles, la', [30.2266, -93.2174]],
  ['lakewood, wa', [47.1718, -122.5185]],
  ['lancaster, ca', [34.6868, -118.1542]],
  ['lancaster, pa', [40.0379, -76.3055]],
  ['lansing, mi', [42.7325, -84.5555]],
  ['laredo, tx', [27.5306, -99.4803]],
  ['las cruces, nm', [32.3199, -106.7637]],
  ['las vegas, nv', [36.1699, -115.1398]],
  ['lawrence, ks', [38.9717, -95.2353]],
  ['lawrence, ma', [42.7070, -71.1631]],
  ['lebanon, or', [44.5365, -122.9070]],
  ['leominster, ma', [42.5251, -71.7598]],
  ['lewiston, id', [46.4166, -117.0166]],
  ['lewiston, me', [44.1004, -70.2148]],
  ['lexington, ky', [38.0406, -84.5037]],
  ['lima, oh', [40.7426, -84.1052]],
  ['lincoln, ne', [40.8136, -96.7026]],
  ['lincoln, ri', [41.9203, -71.4345]],
  ['little rock, ar', [34.7465, -92.2896]],
  ['livonia, mi', [42.3684, -83.3529]],
  ['long beach, ca', [33.7701, -118.1937]],
  ['longview, tx', [32.5007, -94.7405]],
  ['longview, wa', [46.1382, -122.9382]],
  ['los angeles, ca', [34.0522, -118.2437]],
  ['louisville, ky', [38.2527, -85.7585]],
  ['loveland, co', [40.3978, -105.0749]],
  ['lowell, ma', [42.6334, -71.3162]],
  ['lubbock, tx', [33.5779, -101.8552]],
  ['lynchburg, va', [37.4138, -79.1422]],
  ['lynn, ma', [42.4668, -70.9495]],
  ['macon, ga', [32.8407, -83.6324]],
  ['madison, wi', [43.0731, -89.4012]],
  ['manchester, nh', [42.9956, -71.4548]],
  ['manhattan, ks', [39.1836, -96.5717]],
  ['mansfield, oh', [40.7584, -82.5154]],
  ['marshall, tx', [32.5449, -94.3674]],
  ['mcallen, tx', [26.2034, -98.2300]],
  ['mcminnville, or', [45.2101, -123.1986]],
  ['medford, or', [42.3265, -122.8756]],
  ['melbourne, fl', [28.0836, -80.6081]],
  ['memphis, tn', [35.1495, -90.0490]],
  ['merced, ca', [37.3022, -120.4830]],
  ['meridian, id', [43.6121, -116.3915]],
  ['mesa, az', [33.4152, -111.8315]],
  ['miami, fl', [25.7617, -80.1918]],
  ['michigan city, in', [41.7075, -86.8950]],
  ['middletown, ct', [41.5623, -72.6506]],
  ['middletown, ny', [41.4459, -74.4229]],
  ['midland, mi', [43.6156, -84.2472]],
  ['midland, tx', [31.9973, -102.0779]],
  ['milwaukee, wi', [43.0389, -87.9065]],
  ['minneapolis, mn', [44.9778, -93.2650]],
  ['mishawaka, in', [41.6619, -86.1586]],
  ['missoula, mt', [46.8721, -113.9940]],
  ['mobile, al', [30.6954, -88.0399]],
  ['modesto, ca', [37.6391, -120.9969]],
  ['molalla, or', [45.1471, -122.5770]],
  ['monroe, la', [32.5093, -92.1193]],
  ['montgomery, al', [32.3792, -86.3077]],
  ['montrose, co', [38.4783, -107.8762]],
  ['moses lake, wa', [47.1301, -119.2781]],
  ['moscow, id', [46.7324, -117.0002]],
  ['mount vernon, wa', [48.4198, -122.3335]],
  ['muncie, in', [40.1934, -85.3864]],
  ['murfreesboro, tn', [35.8456, -86.3903]],
  ['muskegon, mi', [43.2342, -86.2484]],
  ['myrtle beach, sc', [33.6891, -78.8867]],
  ['nampa, id', [43.5788, -116.5596]],
  ['nashua, nh', [42.7654, -71.4676]],
  ['nashville, tn', [36.1627, -86.7816]],
  ['neah bay, wa', [48.3681, -124.6250]],
  ['nespelem, wa', [48.1696, -118.9750]],
  ['new bedford, ma', [41.6362, -70.9342]],
  ['new brunswick, nj', [40.4862, -74.4518]],
  ['new haven, ct', [41.3083, -72.9279]],
  ['new london, ct', [41.3557, -72.0995]],
  ['new orleans, la', [29.9511, -90.0715]],
  ['new york, ny', [40.7128, -74.0060]],
  ['newark, nj', [40.7357, -74.1724]],
  ['newburgh, ny', [41.5034, -74.0104]],
  ['newport news, va', [36.9785, -76.4280]],
  ['newport, ky', [39.0914, -84.4958]],
  ['newport, or', [44.6368, -124.0535]],
  ['niagara falls, ny', [43.0962, -79.0377]],
  ['norfolk, va', [36.8508, -76.2859]],
  ['norwalk, ct', [41.1177, -73.4079]],
  ['oakland, ca', [37.8044, -122.2712]],
  ['ocala, fl', [29.1872, -82.1401]],
  ['oceanside, ca', [33.1959, -117.3795]],
  ['odessa, tx', [31.8457, -102.3676]],
  ['ogden, ut', [41.2230, -111.9738]],
  ['oklahoma city, ok', [35.4676, -97.5164]],
  ['olympia, wa', [47.0379, -122.9007]],
  ['omaha, ne', [41.2565, -95.9345]],
  ['ontario, ca', [34.0633, -117.6509]],
  ['ontario, or', [44.0266, -116.9629]],
  ['orange, ca', [33.7879, -117.8531]],
  ['oregon city, or', [45.3573, -122.6068]],
  ['orlando, fl', [28.5383, -81.3792]],
  ['oshkosh, wi', [44.0247, -88.5426]],
  ['oxnard, ca', [34.1975, -119.1770]],
  ['palm bay, fl', [27.9758, -80.6629]],
  ['palm springs, ca', [33.8303, -116.5453]],
  ['panama city, fl', [30.1588, -85.6602]],
  ['parkersburg, wv', [39.2667, -81.5615]],
  ['pasadena, ca', [34.1478, -118.1445]],
  ['pasadena, tx', [29.6911, -95.2091]],
  ['paterson, nj', [40.9168, -74.1718]],
  ['pensacola, fl', [30.4213, -87.2169]],
  ['peoria, il', [40.6936, -89.5890]],
  ['philadelphia, pa', [39.9526, -75.1652]],
  ['phoenix, az', [33.4484, -112.0740]],
  ['pierre, sd', [44.3683, -100.3510]],
  ['pittsburgh, pa', [40.4406, -79.9959]],
  ['plummer, id', [47.3352, -116.8885]],
  ['pocatello, id', [42.8713, -112.4455]],
  ['pomona, ca', [34.0551, -117.7500]],
  ['pontiac, mi', [42.6389, -83.2910]],
  ['port angeles, wa', [48.1181, -123.4307]],
  ['port arthur, tx', [29.8850, -93.9288]],
  ['port st. lucie, fl', [27.2730, -80.3582]],
  ['port townsend, wa', [48.1170, -122.7604]],
  ['portland, me', [43.6591, -70.2568]],
  ['portland, or', [45.5152, -122.6784]],
  ['portsmouth, nh', [43.0718, -70.7626]],
  ['portsmouth, va', [36.8354, -76.2983]],
  ['poughkeepsie, ny', [41.7062, -73.9282]],
  ['prescott, az', [34.5400, -112.4685]],
  ['providence, ri', [41.8240, -71.4128]],
  ['provo, ut', [40.2338, -111.6585]],
  ['pullman, wa', [46.7314, -117.1796]],
  ['racine, wi', [42.7261, -87.7829]],
  ['raleigh, nc', [35.7796, -78.6382]],
  ['rapid city, sd', [44.0805, -103.2310]],
  ['reading, pa', [40.3356, -75.9269]],
  ['redding, ca', [40.5865, -122.3917]],
  ['reno, nv', [39.5296, -119.8138]],
  ['richland, wa', [46.2857, -119.2844]],
  ['richmond, in', [39.8289, -84.8902]],
  ['richmond, va', [37.5407, -77.4360]],
  ['riverside, ca', [33.9533, -117.3962]],
  ['roanoke, va', [37.2710, -79.9414]],
  ['rochester, mn', [44.0121, -92.4802]],
  ['rochester, ny', [43.1566, -77.6088]],
  ['rock island, il', [41.5095, -90.5788]],
  ['rockford, il', [42.2711, -89.0937]],
  ['rockville, md', [39.0840, -77.1528]],
  ['rome, ga', [34.2570, -85.1647]],
  ['roseville, ca', [38.7521, -121.2880]],
  ['sacramento, ca', [38.5816, -121.4944]],
  ['saginaw, mi', [43.4195, -83.9508]],
  ['saint helens, or', [45.8640, -122.8065]],
  ['saint louis, mo', [38.6270, -90.1994]],
  ['saint paul, mn', [44.9537, -93.0900]],
  ['saint petersburg, fl', [27.7676, -82.6403]],
  ['salem, or', [44.9429, -123.0351]],
  ['salina, ks', [38.8403, -97.6114]],
  ['salt lake city, ut', [40.7608, -111.8910]],
  ['san angelo, tx', [31.4638, -100.4370]],
  ['san antonio, tx', [29.4241, -98.4936]],
  ['san bernardino, ca', [34.1083, -117.2898]],
  ['san diego, ca', [32.7157, -117.1611]],
  ['san francisco, ca', [37.7749, -122.4194]],
  ['san jose, ca', [37.3382, -121.8863]],
  ['san luis obispo, ca', [35.2828, -120.6596]],
  ['san marcos, tx', [29.8833, -97.9414]],
  ['san rafael, ca', [37.9735, -122.5311]],
  ['sandy, or', [45.3973, -122.2614]],
  ['santa ana, ca', [33.7456, -117.8677]],
  ['santa barbara, ca', [34.4208, -119.6982]],
  ['santa clarita, ca', [34.3917, -118.5426]],
  ['santa cruz, ca', [36.9741, -122.0308]],
  ['santa fe, nm', [35.6870, -105.9378]],
  ['santa maria, ca', [34.9530, -120.4357]],
  ['santa monica, ca', [34.0195, -118.4912]],
  ['santa rosa, ca', [38.4405, -122.7144]],
  ['sarasota, fl', [27.3364, -82.5307]],
  ['savannah, ga', [32.0809, -81.0912]],
  ['scranton, pa', [41.4089, -75.6624]],
  ['seattle, wa', [47.6062, -122.3321]],
  ['sheboygan, wi', [43.7508, -87.7145]],
  ['shelton, wa', [47.2151, -123.1007]],
  ['shreveport, la', [32.5252, -93.7502]],
  ['sioux city, ia', [42.4999, -96.4003]],
  ['sioux falls, sd', [43.5446, -96.7311]],
  ['sitka, ak', [57.0531, -135.3300]],
  ['somerville, ma', [42.3876, -71.0995]],
  ['south bend, in', [41.6764, -86.2520]],
  ['spokane, wa', [47.6588, -117.4260]],
  ['springfield, il', [39.7817, -89.6501]],
  ['springfield, ma', [42.1015, -72.5898]],
  ['springfield, mo', [37.2089, -93.2923]],
  ['springfield, oh', [39.9242, -83.8088]],
  ['state college, pa', [40.7934, -77.8600]],
  ['steuben, me', [44.5106, -67.9669]],
  ['stevenson, wa', [45.6959, -121.8835]],
  ['stockton, ca', [37.9577, -121.2908]],
  ['sweet home, or', [44.3976, -122.7360]],
  ['syracuse, ny', [43.0481, -76.1474]],
  ['tacoma, wa', [47.2529, -122.4443]],
  ['tallahassee, fl', [30.4383, -84.2807]],
  ['tampa, fl', [27.9506, -82.4572]],
  ['tempe, az', [33.4255, -111.9401]],
  ['terre haute, in', [39.4667, -87.4139]],
  ['texarkana, tx', [33.4251, -94.0477]],
  ['the dalles, or', [45.5946, -121.1787]],
  ['tillamook, or', [45.4562, -123.8445]],
  ['toledo, oh', [41.6528, -83.5379]],
  ['topeka, ks', [39.0473, -95.6752]],
  ['torrance, ca', [33.8358, -118.3406]],
  ['trenton, nj', [40.2206, -74.7597]],
  ['tucson, az', [32.2226, -110.9747]],
  ['tulsa, ok', [36.1540, -95.9928]],
  ['tuscaloosa, al', [33.2098, -87.5692]],
  ['tyler, tx', [32.3513, -95.3011]],
  ['utica, ny', [43.1009, -75.2327]],
  ['vancouver, wa', [45.6387, -122.6615]],
  ['ventura, ca', [34.2746, -119.2290]],
  ['victoria, tx', [28.8053, -97.0036]],
  ['virginia beach, va', [36.8529, -75.9780]],
  ['visalia, ca', [36.3302, -119.2921]],
  ['waco, tx', [31.5493, -97.1467]],
  ['wallace, id', [47.4741, -115.9265]],
  ['walla walla, wa', [46.0646, -118.3430]],
  ['warren, mi', [42.5145, -83.0147]],
  ['warren, oh', [41.2376, -80.8184]],
  ['wasilla, ak', [61.5814, -149.4394]],
  ['waterbury, ct', [41.5582, -73.0515]],
  ['waterloo, ia', [42.4928, -92.3426]],
  ['wausau, wi', [44.9591, -89.6301]],
  ['waynesville, nc', [35.4887, -82.9889]],
  ['wellpinit, wa', [47.8802, -118.0849]],
  ['wenatchee, wa', [47.4235, -120.3104]],
  ['west palm beach, fl', [26.7153, -80.0534]],
  ['westminster, md', [39.5754, -76.9955]],
  ['wichita falls, tx', [33.9137, -98.4934]],
  ['wichita, ks', [37.6872, -97.3301]],
  ['wilkes-barre, pa', [41.2459, -75.8813]],
  ['wilmington, de', [39.7391, -75.5398]],
  ['wilmington, nc', [34.2257, -77.9447]],
  ['wilsonville, or', [45.2998, -122.7737]],
  ['worcester, ma', [42.2626, -71.8023]],
  ['yaktima, wa', [46.6021, -120.5059]],
  ['york, pa', [39.9626, -76.7277]],
  ['youngstown, oh', [41.0998, -80.6495]],
  ['yuma, az', [32.6927, -114.6277]],
  // Additional smaller cities from the DOT CSV
  ['amite, la', [30.7266, -90.5093]],
  ['anasco, pr', [18.2827, -67.1405]],
  ['aguada, pr', [18.3802, -67.1882]],
  ['anthony, tx', [31.9993, -106.6058]],
  ['altavista, va', [37.1085, -79.2853]],
  ['alturas, ca', [41.4874, -120.5424]],
  ['alhambra, ca', [34.0953, -118.1260]],
  ['aimler, tn', [35.5142, -87.1147]],
  ['belle chasse, la', [29.8505, -90.0037]],
  ['batavia, ny', [42.9981, -78.1875]],
  ['calverton, ny', [40.9062, -72.7515]],
  ['cathlamet, wa', [46.2032, -123.3834]],
  ['centralia, wa', [46.7162, -122.9543]],
  ['chiloquin, or', [42.5776, -121.8660]],
  ['clarkson, wa', [46.4196, -117.0866]],
  ['coupeville, wa', [48.2198, -122.6860]],
  ['ellicott city, md', [39.2673, -76.7983]],
  ['gakona, ak', [62.3019, -145.3020]],
  ['girdwood, ak', [60.9425, -149.1664]],
  ['hardy, ar', [36.3156, -91.4832]],
  ['hurley, wi', [46.4494, -90.1860]],
  ['ignacio, co', [37.1169, -107.6333]],
  ['kingwood, wv', [39.4715, -79.6842]],
  ['la plata, md', [38.5293, -76.9753]],
  ['lamar, co', [38.0872, -102.6208]],
  ['lapwai, id', [46.4049, -116.8051]],
  ['levelland, tx', [33.5873, -102.3789]],
  ['montevideo, mn', [44.9480, -95.7170]],
  ['moscow, tn', [35.0620, -89.4037]],
  ['new windsor, ny', [41.4668, -74.0238]],
  ['okanogan, wa', [48.3618, -119.5831]],
  ['omak, wa', [48.4109, -119.5276]],
  ['paramus, nj', [40.9445, -74.0749]],
  ['pendleton, or', [45.6721, -118.7886]],
  ['plano, tx', [33.0198, -96.6989]],
  ['prince frederick, md', [38.5409, -76.5840]],
  ['radford, va', [37.1318, -80.5764]],
  ['raymond, wa', [46.6865, -123.7335]],
  ['saint augustine, fl', [29.8947, -81.3145]],
  ['saint joseph, mo', [39.7675, -94.8466]],
  ['sandy, ut', [40.5916, -111.8840]],
  ['shelton, ct', [41.3165, -73.0934]],
  ['steubenville, oh', [40.3695, -80.6340]],
  ['toppenish, wa', [46.3774, -120.3087]],
  ['upper marlboro, md', [38.8159, -76.7497]],
  ['waite park, mn', [45.5589, -94.2344]],
  ['waseca, mn', [44.0786, -93.5074]],
  ['weirton, wv', [40.4190, -80.5863]],
  ['white river junction, vt', [43.6486, -72.3194]],
  ['winona, mn', [44.0500, -91.6393]],
  ['worthington, mn', [43.6200, -95.5964]],
  ['zumbrota, mn', [44.2933, -92.6674]],
  // Missing major metros (not matched by earlier entries)
  ['washington, dc', [38.9072, -77.0369]],
  ['saint louis, mo', [38.6270, -90.1994]],
  ['hampton, va', [37.0299, -76.3452]],
  ['norfolk, va', [36.8508, -76.2859]],
  ['virginia beach, va', [36.8529, -75.9780]],
  ['madison, tn', [36.2562, -86.7136]],
  ['franklin, tn', [35.9251, -86.8689]],
  ['boise, id', [43.6150, -116.2023]],
  ['new bedford, ma', [41.6362, -70.9342]],
  ['camden, nj', [39.9259, -75.1196]],
  ['newark, nj', [40.7357, -74.1724]],
  ['jersey city, nj', [40.7178, -74.0431]],
  ['paterson, nj', [40.9168, -74.1718]],
  ['elizabeth, nj', [40.6636, -74.2107]],
  ['trenton, nj', [40.2206, -74.7597]],
  ['york, pa', [39.9626, -76.7277]],
  ['reading, pa', [40.3356, -75.9269]],
  ['allentown, pa', [40.6084, -75.4902]],
  ['scranton, pa', [41.4089, -75.6624]],
  ['wilmington, de', [39.7391, -75.5398]],
  ['dover, de', [39.1582, -75.5244]],
  ['saint paul, mn', [44.9537, -93.0900]],
  ['duluth, mn', [46.7867, -92.1005]],
]);

// ── CSV parsing ─────────────────────────────────────────────────────

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current.trim());
  return values;
}

// ── GeoNames SQLite lookup (optional) ───────────────────────────────

let db = null;
const GEONAMES_DB_PATH = resolve(PROJECT_ROOT, 'geonames.sqlite');

try {
  statSync(GEONAMES_DB_PATH);
  const Database = (await import('better-sqlite3')).default;
  db = new Database(GEONAMES_DB_PATH, { readonly: true });
  console.log(`Using geonames SQLite DB at ${GEONAMES_DB_PATH}`);
} catch {
  console.log('GeoNames SQLite DB not found — using embedded city coordinate map');
}

function lookupGeoName(city, state) {
  if (!db) return null;

  // Try exact match on city name within the state
  const rows = db
    .prepare(
      `SELECT lat, lng, population FROM geonames
       WHERE country_code = 'US'
         AND admin1_code = ?
         AND (name = ? OR ascii_name = ?)
         AND feature_class = 'P'
       ORDER BY population DESC
       LIMIT 1`,
    )
    .all(state, city, city);

  if (rows.length > 0) return [rows[0].lat, rows[0].lng];

  // Try LIKE match
  const likeRows = db
    .prepare(
      `SELECT lat, lng, population FROM geonames
       WHERE country_code = 'US'
         AND admin1_code = ?
         AND (name LIKE ? OR ascii_name LIKE ?)
         AND feature_class = 'P'
       ORDER BY population DESC
       LIMIT 1`,
    )
    .all(state, `${city}%`, `${city}%`);

  if (likeRows.length > 0) return [likeRows[0].lat, likeRows[0].lng];

  return null;
}

// ── US state abbreviation → admin1 code mapping ─────────────────────

const STATE_TO_ADMIN1 = {
  AK: 'AK', AL: 'AL', AR: 'AR', AS: 'AS', AZ: 'AZ',
  CA: 'CA', CO: 'CO', CT: 'CT', DC: 'DC', DE: 'DE',
  FL: 'FL', GA: 'GA', GU: 'GU', HI: 'HI', IA: 'IA',
  ID: 'ID', IL: 'IL', IN: 'IN', KS: 'KS', KY: 'KY',
  LA: 'LA', MA: 'MA', MD: 'MD', ME: 'ME', MI: 'MI',
  MN: 'MN', MO: 'MO', MP: 'MP', MS: 'MS', MT: 'MT',
  NC: 'NC', ND: 'ND', NE: 'NE', NH: 'NH', NJ: 'NJ',
  NM: 'NM', NV: 'NV', NY: 'NY', OH: 'OH', OK: 'OK',
  OR: 'OR', PA: 'PA', PR: 'PR', RI: 'RI', SC: 'SC',
  SD: 'SD', TN: 'TN', TX: 'TX', UT: 'UT', VA: 'VA',
  VI: 'VI', VT: 'VT', WA: 'WA', WI: 'WI', WV: 'WV',
  WY: 'WY',
};

// ── GTFS mode abbreviation → readable mode name ─────────────────────

const MODE_MAP = {
  MB: 'Bus',
  CB: 'Commuter Bus',
  RB: 'Bus Rapid Transit',
  LR: 'Light Rail',
  HR: 'Heavy Rail',
  CR: 'Commuter Rail',
  SR: 'Streetcar Rail',
  TB: 'Trolleybus',
  FB: 'Ferryboat',
  AR: 'Alaska Railroad',
  MG: 'Monorail/Automated Guideway',
  TR: 'Aerial Tramway',
  IP: 'Inclined Plane',
  YR: 'Hybrid Rail',
};

// ── Main ────────────────────────────────────────────────────────────

console.log(`Parsing ${CSV_PATH} …`);

const csvText = readFileSync(CSV_PATH, 'utf-8');
const lines = csvText.split('\n').filter((l) => l.trim());
if (lines.length < 2) {
  console.error('CSV file appears empty or malformed');
  process.exit(1);
}

const headers = parseCsvLine(lines[0]);
const feedEntries = [];

for (let i = 1; i < lines.length; i++) {
  const values = parseCsvLine(lines[i]);
  if (values.length < headers.length) continue;

  const row = {};
  for (let j = 0; j < headers.length; j++) {
    row[headers[j]] = values[j];
  }

  const ntdId = row['NTD ID']?.replace(/^"|"$/g, '');
  const agencyName = row['Agency Name']?.replace(/^"|"$/g, '');
  const city = row['City']?.replace(/^"|"$/g, '');
  const state = row['State']?.replace(/^"|"$/g, '');
  const modeName = row['Mode Name']?.replace(/^"|"$/g, '');
  const modeAbbr = row['Mode']?.replace(/^"|"$/g, '');
  const uzaName = row['UZA Name']?.replace(/^"|"$/g, '');
  const uzaPop = parseInt(row['Primary UZA Population']?.replace(/^"|"$/g, '').replace(/,/g, ''), 10) || 0;
  const weblink = row['Weblink']?.replace(/^"|"$/g, '');
  const dateValidated = row['Date Validated']?.replace(/^"|"$/g, '');
  const certified = row['Certification Flag']?.replace(/^"|"$/g, '') === 'true';

  if (!ntdId || !agencyName || !city || !state) continue;

  feedEntries.push({
    ntdId,
    agencyName,
    city,
    state,
    modeName: modeName || 'Unknown',
    modeAbbr: modeAbbr || 'MB',
    uzaName: uzaName || '',
    uzaPop,
    weblink: weblink?.startsWith('http') ? weblink : '',
    dateValidated: dateValidated || '',
    certified,
  });
}

console.log(`Parsed ${feedEntries.length} feed rows`);

// ── Deduplicate by NTD ID + URL ─────────────────────────────────────

const deduped = new Map();
for (const entry of feedEntries) {
  const key = `${entry.ntdId}:${entry.modeAbbr}`;
  const existing = deduped.get(key);
  // Prefer entries with URLs, then with certification, then most recently validated
  if (!existing) {
    deduped.set(key, entry);
  } else if (!existing.weblink && entry.weblink) {
    deduped.set(key, entry);
  } else if (entry.certified && !existing.certified) {
    deduped.set(key, entry);
  } else if (entry.dateValidated > existing.dateValidated) {
    deduped.set(key, entry);
  }
}

console.log(`After dedup: ${deduped.size} unique feeds (${feedEntries.length - deduped.size} duplicates removed)`);

// ── Look up city coordinates ────────────────────────────────────────

const coordCache = new Map();
const unmatched = new Set();
let matchedCount = 0;

for (const entry of deduped.values()) {
  const key = `${entry.city}, ${entry.state}`.toLowerCase();

  if (coordCache.has(key)) {
    entry.coords = coordCache.get(key);
    if (entry.coords) matchedCount++;
    continue;
  }

  // 1. Try embedded US cities map
  const embedded = US_CITY_COORDS.get(key);
  if (embedded) {
    coordCache.set(key, embedded);
    entry.coords = embedded;
    matchedCount++;
    continue;
  }

  // 2. Try geonames SQLite DB
  const geoLookup = lookupGeoName(entry.city, STATE_TO_ADMIN1[entry.state]);
  if (geoLookup) {
    coordCache.set(key, geoLookup);
    entry.coords = geoLookup;
    matchedCount++;
    continue;
  }

  // 3. No coordinates found
  coordCache.set(key, null);
  entry.coords = null;
  unmatched.add(`${entry.city}, ${entry.state}`);
}

console.log(`Coordinates found: ${matchedCount}/${deduped.size}`);
if (unmatched.size > 0) {
  console.log(`Unmatched cities (${unmatched.size}):`);
  for (const c of [...unmatched].sort().slice(0, 20)) {
    console.log(`  - ${c}`);
  }
  if (unmatched.size > 20) {
    console.log(`  ... and ${unmatched.size - 20} more`);
  }
}

// ── Build spatial index ─────────────────────────────────────────────

const BUCKET_SIZE = 0.1; // ~11 km
const buckets = {};
const flatEntries = [];

for (const entry of deduped.values()) {
  if (!entry.coords) continue;

  const [lat, lng] = entry.coords;
  const bucketKey = `${(Math.floor(lat / BUCKET_SIZE) * BUCKET_SIZE).toFixed(1)},${(Math.floor(lng / BUCKET_SIZE) * BUCKET_SIZE).toFixed(1)}`;

  if (!buckets[bucketKey]) {
    buckets[bucketKey] = [];
  }

  const feedId = `${entry.ntdId}:${entry.modeAbbr}`;
  buckets[bucketKey].push(feedId);

  flatEntries.push({
    id: feedId,
    ntdId: entry.ntdId,
    agencyName: entry.agencyName,
    city: entry.city,
    state: entry.state,
    modeName: entry.modeName,
    modeAbbr: entry.modeAbbr,
    uzaName: entry.uzaName,
    uzaPop: entry.uzaPop,
    weblink: entry.weblink,
    lat,
    lng,
    dateValidated: entry.dateValidated,
    certified: entry.certified,
  });
}

// ── Output ──────────────────────────────────────────────────────────

const index = {
  version: 1,
  generatedAt: new Date().toISOString(),
  bucketSize: BUCKET_SIZE,
  buckets,
  entries: flatEntries,
};

writeFileSync(OUTPUT_PATH, JSON.stringify(index, null, 2));
const stats = statSync(OUTPUT_PATH);
console.log(`\nDone — ${flatEntries.length} feeds indexed into ${Object.keys(buckets).length} spatial buckets`);
console.log(`  Output: ${OUTPUT_PATH}`);
console.log(`  Size: ${(stats.size / 1024).toFixed(1)} KB`);

if (db) db.close();

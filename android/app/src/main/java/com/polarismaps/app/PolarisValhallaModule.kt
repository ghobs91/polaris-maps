package com.polarismaps.app

import com.facebook.react.bridge.*
import com.valhalla.api.models.*
import com.valhalla.config.ValhallaConfigBuilder
import com.valhalla.valhalla.Valhalla
import com.valhalla.valhalla.ValhallaException
import com.valhalla.valhalla.ValhallaResponse
import java.io.File

/**
 * React Native NativeModule wrapping the valhalla-mobile library for on-device routing.
 *
 * This module provides the primary offline routing path for Polaris Maps.
 * When local tiles are available, routing is computed entirely on-device
 * using Valhalla's C++ engine via the valhalla-mobile library.
 * When the native module is not available or fails, the JS layer falls
 * back to the public OSM Valhalla HTTP API at valhalla1.openstreetmap.de.
 */
class PolarisValhallaModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "PolarisValhalla"

    private var valhallaInstance: Valhalla? = null
    private var isInitialized = false

    @ReactMethod
    fun initialize(config: ReadableMap, promise: Promise) {
        try {
            val graphTilePath = config.getString("graphTilePath") ?: ""

            val configBuilder = ValhallaConfigBuilder()
            if (graphTilePath.endsWith(".tar")) {
                configBuilder.withTileExtract(graphTilePath)
            } else {
                configBuilder.withTileDir(graphTilePath)
            }
            val valhallaConfig = configBuilder.build()

            // Dispose previous instance if re-initializing
            valhallaInstance = null

            valhallaInstance = Valhalla(
                reactApplicationContext,
                valhallaConfig
            )
            isInitialized = true
            promise.resolve(null)
        } catch (e: ValhallaException) {
            isInitialized = false
            promise.reject("VALHALLA_INIT_ERROR", "Failed to initialize Valhalla: ${e.message}", e)
        } catch (e: Exception) {
            isInitialized = false
            promise.reject("VALHALLA_INIT_ERROR", "Failed to initialize Valhalla: ${e.message}", e)
        }
    }

    @ReactMethod
    fun computeRoute(waypoints: ReadableArray, costing: String, options: ReadableMap?, promise: Promise) {
        try {
            val instance = valhallaInstance
            if (!isInitialized || instance == null) {
                promise.reject("VALHALLA_NOT_INITIALIZED", "Valhalla routing engine is not initialized. Call initialize() first.")
                return
            }

            val locations = mutableListOf<RoutingWaypoint>()
            for (i in 0 until waypoints.size()) {
                val wp = waypoints.getMap(i)
                locations.add(
                    RoutingWaypoint(
                        lat = wp.getDouble("lat"),
                        lon = wp.getDouble("lng")
                    )
                )
            }

            val request = buildRouteRequest(locations, costing, options)
            val response = instance.route(request)

            when (response) {
                is ValhallaResponse.Json -> {
                    val result = mapRouteResponseToNative(response.jsonResponse, locations)
                    promise.resolve(result)
                }
                is ValhallaResponse.Osrm -> {
                    // Convert OSRM-format response to our native format
                    val result = mapOsrmResponseToNative(response.osrmResponse, locations)
                    promise.resolve(result)
                }
            }
        } catch (e: ValhallaException) {
            promise.reject("VALHALLA_ROUTE_ERROR", "Route computation failed: ${e.message}", e)
        } catch (e: Exception) {
            promise.reject("VALHALLA_ROUTE_ERROR", "Route computation failed: ${e.message}", e)
        }
    }

    @ReactMethod
    fun reroute(currentPosition: ReadableMap, destination: ReadableMap, costing: String, promise: Promise) {
        try {
            val instance = valhallaInstance
            if (!isInitialized || instance == null) {
                promise.reject("VALHALLA_NOT_INITIALIZED", "Valhalla routing engine is not initialized.")
                return
            }

            val fromLat = currentPosition.getDouble("lat")
            val fromLng = currentPosition.getDouble("lng")
            val toLat = destination.getDouble("lat")
            val toLng = destination.getDouble("lng")

            val locations = listOf(
                RoutingWaypoint(lat = fromLat, lon = fromLng),
                RoutingWaypoint(lat = toLat, lon = toLng)
            )

            val request = RouteRequest(
                locations = locations,
                costing = mapCostingModel(costing),
                directionsOptions = DirectionsOptions(
                    units = DirectionsOptions.Units.km,
                    format = DirectionsOptions.Format.json
                )
            )

            val response = instance.route(request)

            when (response) {
                is ValhallaResponse.Json -> {
                    val result = mapSingleRouteToNative(response.jsonResponse)
                    promise.resolve(result)
                }
                is ValhallaResponse.Osrm -> {
                    val result = mapSingleOsrmRouteToNative(response.osrmResponse)
                    promise.resolve(result)
                }
            }
        } catch (e: ValhallaException) {
            promise.reject("VALHALLA_REROUTE_ERROR", "Reroute failed: ${e.message}", e)
        } catch (e: Exception) {
            promise.reject("VALHALLA_REROUTE_ERROR", "Reroute failed: ${e.message}", e)
        }
    }

    @ReactMethod
    fun updateTrafficSpeeds(speeds: ReadableMap, promise: Promise) {
        // Not supported by valhalla-mobile — traffic is handled by the JS layer via TomTom
        promise.resolve(null)
    }

    @ReactMethod
    fun hasCoverage(bounds: ReadableMap, promise: Promise) {
        promise.resolve(isInitialized)
    }

    @ReactMethod
    fun getLoadedRegions(promise: Promise) {
        // valhalla-mobile doesn't expose region tracking; JS layer manages regions
        promise.resolve(Arguments.createArray())
    }

    @ReactMethod
    fun dispose(promise: Promise) {
        valhallaInstance = null
        isInitialized = false
        promise.resolve(null)
    }

    // --- Private helpers ---

    private fun buildRouteRequest(
        locations: List<RoutingWaypoint>,
        costing: String,
        options: ReadableMap?
    ): RouteRequest {
        val avoidTolls = options?.getBoolean("avoidTolls") ?: false
        val avoidHighways = options?.getBoolean("avoidHighways") ?: false
        val avoidFerries = options?.getBoolean("avoidFerries") ?: false
        val alternates = options?.getInt("alternates") ?: 0

        val costingOptions: Map<String, Any> = when (costing) {
            "auto" -> mapOf(
                "use_tolls" to (if (avoidTolls) 0 else 1),
                "use_highways" to (if (avoidHighways) 0 else 1),
                "use_ferry" to (if (avoidFerries) 0 else 1)
            )
            else -> emptyMap()
        }

        return RouteRequest(
            locations = locations,
            costing = mapCostingModel(costing),
            directionsOptions = DirectionsOptions(
                units = DirectionsOptions.Units.km,
                format = DirectionsOptions.Format.json
            ),
            costingOptions = costingOptions,
            alternates = alternates
        )
    }

    private fun mapCostingModel(costing: String): CostingModel = when (costing) {
        "auto" -> CostingModel.auto
        "pedestrian" -> CostingModel.pedestrian
        "bicycle" -> CostingModel.bicycle
        else -> CostingModel.auto
    }

    private fun mapRouteResponseToNative(response: RouteResponse, locations: List<RoutingWaypoint>): WritableArray {
        // Valhalla can return alternates, wrap single response in array
        val arr = Arguments.createArray()
        arr.pushMap(mapSingleRouteToNative(response))
        return arr
    }

    private fun mapSingleRouteToNative(response: RouteResponse): WritableMap {
        val trip = response.trip
        val summary = trip.summary

        val legs = Arguments.createArray()
        trip.legs?.forEach { leg ->
            val maneuvers = Arguments.createArray()
            leg.maneuvers?.forEach { m ->
                val maneuver = Arguments.createMap().apply {
                    putString("type", mapManeuverType(m.type ?: 0))
                    putString("instruction", m.instruction ?: "")
                    putDouble("distance_meters", (m.length ?: 0.0) * 1000)
                    putDouble("duration_seconds", (m.time ?: 0.0))
                    putInt("begin_shape_index", m.beginShapeIndex ?: 0)
                    putInt("end_shape_index", m.endShapeIndex ?: 0)
                    putString("verbal_pre_transition", m.verbalPreTransitionInstruction ?: "")
                    if (m.verbalPostTransitionInstruction != null) {
                        putString("verbal_post_transition", m.verbalPostTransitionInstruction)
                    }
                    // street_names as array
                    val namesArr = Arguments.createArray()
                    m.streetNames?.forEach { namesArr.pushString(it) }
                    putArray("street_names", namesArr)
                }
                maneuvers.pushMap(maneuver)
            }

            val legMap = Arguments.createMap().apply {
                putArray("maneuvers", maneuvers)
                putDouble("distance_meters", (leg.summary?.length ?: 0.0) * 1000)
                putDouble("duration_seconds", (leg.summary?.time ?: 0.0))
            }
            legs.pushMap(legMap)
        }

        val shape = trip.legs?.firstOrNull()?.shape ?: ""

        val result = Arguments.createMap()
        result.putMap("summary", Arguments.createMap().apply {
            putDouble("distance_meters", (summary?.length ?: 0.0) * 1000)
            putDouble("duration_seconds", (summary?.time ?: 0.0))
            putBoolean("has_toll", summary?.hasToll ?: false)
            putBoolean("has_ferry", summary?.hasFerry ?: false)
        })
        result.putArray("legs", legs)
        result.putString("geometry", shape)
        result.putArray("bounding_box", Arguments.fromList(listOf(
            summary?.minLon ?: locations.firstOrNull()?.lon ?: 0.0,
            summary?.minLat ?: locations.firstOrNull()?.lat ?: 0.0,
            summary?.maxLon ?: locations.lastOrNull()?.lon ?: 0.0,
            summary?.maxLat ?: locations.lastOrNull()?.lat ?: 0.0
        )))
        return result
    }

    private fun mapManeuverType(code: Int): String = when (code) {
        1, 2, 3 -> "start"
        4, 5, 6 -> "destination"
        7 -> "name_change"
        8 -> "continue"
        9 -> "slight_right"
        10 -> "turn_right"
        11 -> "sharp_right"
        12, 13 -> "u_turn"
        14 -> "sharp_left"
        15 -> "turn_left"
        16 -> "slight_left"
        17, 22 -> "continue"
        18, 19 -> "enter_highway"
        20, 21 -> "exit_highway"
        23 -> "merge_right"
        24, 25 -> "merge_left"
        26 -> "enter_roundabout"
        27 -> "exit_roundabout"
        28 -> "ferry"
        else -> "continue"
    }

    /** Maps OSRM maneuver type strings to ManeuverType strings matching src/models/route.ts. */
    private fun mapOsrmManeuverType(type: String?): String = when (type?.lowercase()) {
        "turn" -> "turn_right"
        "new name" -> "name_change"
        "depart" -> "start"
        "arrive" -> "destination"
        "merge" -> "merge_right"
        "on ramp" -> "enter_highway"
        "off ramp" -> "exit_highway"
        "fork" -> "continue"
        "end of road" -> "continue"
        "use lane" -> "continue"
        "continue" -> "continue"
        "roundabout" -> "enter_roundabout"
        "rotary" -> "enter_roundabout"
        "roundabout turn" -> "exit_roundabout"
        "notification" -> "continue"
        "exit roundabout" -> "exit_roundabout"
        "exit rotary" -> "exit_roundabout"
        else -> "continue"
    }

    // --- OSRM-format response mapping (used when format=osrm is requested) ---

    private fun mapOsrmResponseToNative(response: com.osrm.api.models.RouteResponse, locations: List<RoutingWaypoint>): WritableArray {
        val arr = Arguments.createArray()
        response.routes?.forEach { route ->
            arr.pushMap(mapOsrmRouteToNative(route, response.waypoints ?: emptyList(), locations))
        }
        return arr
    }

    private fun mapOsrmRouteToNative(
        route: com.osrm.api.models.Route,
        waypoints: List<com.osrm.api.models.Waypoint>,
        locations: List<RoutingWaypoint>
    ): WritableMap {
        val legs = Arguments.createArray()
        route.legs?.forEach { leg ->
            val maneuvers = Arguments.createArray()
            leg.steps?.forEach { step ->
                val maneuver = Arguments.createMap().apply {
                    putString("type", mapOsrmManeuverType(step.maneuver?.type))
                    putString("instruction", step.maneuver?.instruction ?: step.name ?: "")
                    putDouble("distance_meters", step.distance ?: 0.0)
                    putDouble("duration_seconds", step.duration ?: 0.0)
                    putInt("begin_shape_index", 0)
                    putInt("end_shape_index", 0)
                    putString("verbal_pre_transition", step.voiceInstructions?.firstOrNull()?.announcement ?: "")
                    val namesArr = Arguments.createArray()
                    step.name?.let { namesArr.pushString(it) }
                    step.ref?.let { namesArr.pushString(it) }
                    putArray("street_names", namesArr)
                }
                maneuvers.pushMap(maneuver)
            }
            val legMap = Arguments.createMap().apply {
                putArray("maneuvers", maneuvers)
                putDouble("distance_meters", leg.distance ?: 0.0)
                putDouble("duration_seconds", leg.duration ?: 0.0)
            }
            legs.pushMap(legMap)
        }

        val result = Arguments.createMap()
        result.putMap("summary", Arguments.createMap().apply {
            putDouble("distance_meters", route.distance ?: 0.0)
            putDouble("duration_seconds", route.duration ?: 0.0)
            putBoolean("has_toll", false)
            putBoolean("has_ferry", false)
        })
        result.putArray("legs", legs)
        result.putString("geometry", route.geometry ?: "")
        result.putArray("bounding_box", Arguments.fromList(listOf(
            waypoints.firstOrNull()?.location?.get(0) ?: locations.firstOrNull()?.lon ?: 0.0,
            waypoints.firstOrNull()?.location?.get(1) ?: locations.firstOrNull()?.lat ?: 0.0,
            waypoints.lastOrNull()?.location?.get(0) ?: locations.lastOrNull()?.lon ?: 0.0,
            waypoints.lastOrNull()?.location?.get(1) ?: locations.lastOrNull()?.lat ?: 0.0
        )))
        return result
    }

    private fun mapSingleOsrmRouteToNative(response: com.osrm.api.models.RouteResponse): WritableMap {
        val route = response.routes?.firstOrNull() ?: return Arguments.createMap()
        return mapOsrmRouteToNative(route, response.waypoints ?: emptyList(), emptyList())
    }
}

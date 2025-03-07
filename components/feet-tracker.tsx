"use client"

import { useRef, useEffect, useState, useCallback } from "react"
import * as tf from "@tensorflow/tfjs"
import "@tensorflow/tfjs-backend-webgl"
import * as poseDetection from "@tensorflow-models/pose-detection"
import getBestCameraStream from "./camera-stream"

interface FeetTrackerProps {
  isRecording: boolean
  showTracking: boolean
  onFeetHeightUpdate: (leftFoot: number, rightFoot: number) => void
  facingMode?: "user" | "environment"
}

export default function FeetTracker({
  isRecording,
  showTracking,
  onFeetHeightUpdate,
  facingMode = "environment",
}: FeetTrackerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [cameraLoading, setCameraLoading] = useState(true)
  const [modelLoading, setModelLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)

  // Stats
  const [jumpCount, setJumpCount] = useState(0)
  const [maxHeight, setMaxHeight] = useState(0)
  const [flightTime, setFlightTime] = useState(0)
  const [lastJumpHeight, setLastJumpHeight] = useState(0)

  // Refs for tracking
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<poseDetection.PoseDetector | null>(null)
  const requestRef = useRef<number | null>(null)
  const groundLevelRef = useRef<number | null>(null)
  const inAirRef = useRef<boolean>(false)
  const jumpStartTimeRef = useRef<number | null>(null)
  const feetPositionsRef = useRef<number[]>([])
  const lastTimeRef = useRef<number>(0)

  // Setup camera
  const setupCamera = useCallback(async () => {
    console.log("DEBUG: Starting setupCamera with facingMode:", facingMode)
    setCameraLoading(true)
    setError(null)

    try {
      // Stop any existing stream
      if (streamRef.current) {
        console.log("DEBUG: Stopping previous camera stream")
        streamRef.current.getTracks().forEach((track) => track.stop())
      }

      // Get user media
      const stream = await getBestCameraStream();

      console.log("DEBUG: Camera stream obtained", stream)
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.setAttribute("playsinline", "true")
        videoRef.current.setAttribute("webkit-playsinline", "true")

        videoRef.current.onloadedmetadata = () => {
          console.log("DEBUG: Video metadata loaded, starting playback")
          videoRef.current
            ?.play()
            .then(() => {
              console.log("DEBUG: Video is playing")
              setCameraLoading(false)
            })
            .catch((e) => {
              console.error("Error playing video:", e)
              setError("Could not play video. Please ensure you've granted camera permissions.")
            })
        }
      }
    } catch (err: any) {
      console.error("DEBUG: Error accessing camera:", err)
      setCameraLoading(false)

      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setError("Camera access denied. Please allow camera access in your browser settings.")
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        setError("No camera found. Please ensure your device has a camera.")
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        setError("Camera is in use by another application or not accessible.")
      } else {
        setError(`Camera error: ${err.message || "Unknown error"}`)
      }
    }
  }, [facingMode])

  // Setup TensorFlow model
  const setupModel = useCallback(async () => {
    console.log("DEBUG: Starting setupModel")
    try {
      setModelLoading(true)

      // Initialize TensorFlow
      await tf.ready()
      console.log("DEBUG: TensorFlow is ready")
      await tf.setBackend("webgl")
      console.log("DEBUG: Backend set to webgl")

      // Create pose detector
      const detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
        modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
        enableSmoothing: true,
      })

      detectorRef.current = detector
      console.log("DEBUG: Pose detector created:", detector)
      setModelLoading(false)
      return detector
    } catch (err) {
      console.error("DEBUG: Error loading pose detection model:", err)
      setError("Failed to load pose detection model. Please try again.")
      setModelLoading(false)
      return null
    }
  }, [])


  const processingRef = useRef(isProcessing)
  useEffect(() => {
    processingRef.current = isProcessing
  }, [isProcessing])


  // Initialize
  useEffect(() => {
    console.log("DEBUG: useEffect initialize - setupCamera and setupModel")
    setupCamera()
    setupModel()

    return () => {
      // Cleanup
      console.log("DEBUG: Cleanup - stopping camera stream and canceling animation frame")
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }

      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current)
        requestRef.current = null
      }
    }
  }, [setupCamera, setupModel])

  // Handle camera change
  useEffect(() => {
    console.log("DEBUG: Facing mode changed, reinitializing camera to", facingMode)
    setupCamera()
  }, [facingMode, setupCamera])

  // Start/stop processing
  useEffect(() => {
    console.log("DEBUG: useEffect for processing - isRecording:", isRecording, "error:", error)
    if (!isRecording || !videoRef.current || error || modelLoading || cameraLoading) {
      console.log("DEBUG: Not processing because conditions not met", isRecording, videoRef.current, error, modelLoading, cameraLoading)
      setIsProcessing(false)
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current)
        requestRef.current = null
      }
      return
    }

    console.log("DEBUG: Starting processing")
    setIsProcessing(true)

    // Reset tracking data when starting new recording
    groundLevelRef.current = null
    inAirRef.current = false
    jumpStartTimeRef.current = null
    feetPositionsRef.current = []
    setJumpCount(0)
    setMaxHeight(0)
    setFlightTime(0)
    setLastJumpHeight(0)

    // Start processing
    processVideo()

    return () => {
      console.log("DEBUG: Stopping processing")
      setIsProcessing(false)
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current)
        requestRef.current = null
      }
    }
  }, [isRecording, error, modelLoading, cameraLoading])

  // Process video frames
  const processVideo = async () => {
    console.log("DEBUG: processVideo called")
    if (!videoRef.current || !canvasRef.current || !detectorRef.current) {
      console.log("DEBUG: processVideo aborted - Missing video, canvas, or detector")
      return
    }

    const detector = detectorRef.current

    const detectPose = async (time: number) => {
      // Log the time each frame is processed (throttled)
      console.log("DEBUG: detectPose called at time:", time)
      if (!processingRef.current || !videoRef.current || !canvasRef.current) {
        console.log("DEBUG: Exiting detectPose - not processing or missing video/canvas")
        if (requestRef.current) {
          cancelAnimationFrame(requestRef.current)
          requestRef.current = null
        }
        return
      }

      // Throttle processing to ~30fps
      if (time - lastTimeRef.current < 60) {
        requestRef.current = requestAnimationFrame(detectPose)
        return
      }

      lastTimeRef.current = time

      const canvas = canvasRef.current
      const ctx = canvas.getContext("2d")

      if (!ctx) {
        console.log("DEBUG: No canvas context available")
        requestRef.current = requestAnimationFrame(detectPose)
        return
      }

      // Match canvas size to video
      const videoWidth = videoRef.current.videoWidth || 640
      const videoHeight = videoRef.current.videoHeight || 480

      if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
        console.log("DEBUG: Updating canvas size to", videoWidth, videoHeight)
        canvas.width = videoWidth
        canvas.height = videoHeight
      }

      // Draw video frame
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height)

      try {
        // Detect poses
        const poses = await detector.estimatePoses(videoRef.current, {
          flipHorizontal: facingMode === "user",
        })
        console.log("DEBUG: Detected poses:", poses)

        if (poses.length > 0) {
          const pose = poses[0]
          processPose(ctx, pose, canvas.width, canvas.height, time)
        }
      } catch (err) {
        console.error("DEBUG: Error processing video frame:", err)
      }

      requestRef.current = requestAnimationFrame(detectPose)
    }

    requestRef.current = requestAnimationFrame(detectPose)
  }

  // Process pose data
  const processPose = (
    ctx: CanvasRenderingContext2D,
    pose: poseDetection.Pose,
    width: number,
    height: number,
    timestamp: number,
  ) => {
    console.log("DEBUG: Processing pose data at timestamp:", timestamp)
    // Get ankle keypoints
    const leftAnkle = pose.keypoints.find((kp) => kp.name === "left_ankle")
    const rightAnkle = pose.keypoints.find((kp) => kp.name === "right_ankle")

    if (!leftAnkle || !rightAnkle) {
      console.log("DEBUG: Missing ankle keypoints", { leftAnkle, rightAnkle })
      return
    }


    var leftFootHeight;
    var rightFootHeight;

    if (leftAnkle.score && rightAnkle.score && rightAnkle.score + leftAnkle.score < 0.6){
      leftFootHeight = 0
      rightFootHeight = 0
    }
    else{
      leftFootHeight = height - leftAnkle.y
      rightFootHeight = height - rightAnkle.y
    }
    // Calculate feet heights (distance from bottom of frame)
    
    
    const avgFootHeight = Math.min(leftFootHeight,rightFootHeight)
    console.log("DEBUG: Foot heights calculated:", { leftFootHeight, rightFootHeight, avgFootHeight })

    // Store for tracking
    feetPositionsRef.current.push(avgFootHeight)
    if (feetPositionsRef.current.length > 30) {
      feetPositionsRef.current.shift()
    }

    // Determine ground level
    if (groundLevelRef.current === null) {
      groundLevelRef.current = avgFootHeight
      console.log("DEBUG: Ground level set to:", groundLevelRef.current)
    } else {
      // Update ground level if we find a lower position (with some tolerance)
      if (avgFootHeight < groundLevelRef.current && avgFootHeight > groundLevelRef.current - 100) {
        groundLevelRef.current = avgFootHeight
        console.log("DEBUG: Ground level updated to:", groundLevelRef.current)
      }
    }

    // Detect jumps
    const jumpThreshold = 20 // pixels above ground level
    const isInAir = groundLevelRef.current !== null && avgFootHeight > groundLevelRef.current + jumpThreshold
    console.log("DEBUG: isInAir:", isInAir)

    // Jump detection logic
    if (isInAir && !inAirRef.current) {
      // Jump start
      inAirRef.current = true
      jumpStartTimeRef.current = timestamp
      console.log("DEBUG: Jump started at:", timestamp)
    } else if (!isInAir && inAirRef.current) {
      // Jump end
      inAirRef.current = false
      console.log("DEBUG: Jump ended at:", timestamp)

      if (jumpStartTimeRef.current !== null) {
        // Calculate flight time
        const jumpFlightTime = (timestamp - jumpStartTimeRef.current) / 1000 // seconds
        console.log("DEBUG: Jump flight time:", jumpFlightTime)

        // Calculate max height during jump
        const recentHeights = feetPositionsRef.current.slice(-15)
        const jumpMaxHeight = Math.max(...recentHeights)
        const relativeJumpHeight = groundLevelRef.current !== null ? jumpMaxHeight - groundLevelRef.current : 0
        console.log("DEBUG: Jump max height:", jumpMaxHeight, "relative jump height:", relativeJumpHeight)

        // Only count as jump if flight time is significant
        if (jumpFlightTime > 0.1) {
          setJumpCount((prev) => prev + 1)
          setFlightTime(jumpFlightTime)
          setLastJumpHeight(relativeJumpHeight)
          setMaxHeight((prev) => Math.max(prev, relativeJumpHeight))
          console.log("DEBUG: Jump counted. Updated stats:", {
            jumpCount: jumpCount + 1,
            flightTime: jumpFlightTime,
            lastJumpHeight: relativeJumpHeight,
            maxHeight: Math.max(maxHeight, relativeJumpHeight),
          })
        }
      }
    }

    // Update chart data
    onFeetHeightUpdate(leftFootHeight, rightFootHeight)

    // Draw visualization if enabled
    if (showTracking) {
      drawVisualization(ctx, pose, width, height, avgFootHeight)
    }
  }

  // Draw tracking visualization
  const drawVisualization = (
    ctx: CanvasRenderingContext2D,
    pose: poseDetection.Pose,
    width: number,
    height: number,
    avgFootHeight: number,
  ) => {
    // Draw ground level
    if (groundLevelRef.current !== null) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.5)"
      ctx.lineWidth = 2
      ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.moveTo(0, height - groundLevelRef.current)
      ctx.lineTo(width, height - groundLevelRef.current)
      ctx.stroke()
      ctx.setLineDash([])

      // Label
      ctx.fillStyle = "rgba(255, 255, 255, 0.7)"
      ctx.font = "12px Arial"
      ctx.fillText("Ground Level", 10, height - groundLevelRef.current - 5)
      console.log("DEBUG: Ground level drawn at:", height - groundLevelRef.current)
    }

    // Draw skeleton
    const connections = [
      ["left_hip", "left_knee"],
      ["left_knee", "left_ankle"],
      ["right_hip", "right_knee"],
      ["right_knee", "right_ankle"],
      ["left_hip", "right_hip"],
      ["left_shoulder", "right_shoulder"],
      ["left_shoulder", "left_elbow"],
      ["left_elbow", "left_wrist"],
      ["right_shoulder", "right_elbow"],
      ["right_elbow", "right_wrist"],
      ["left_shoulder", "left_hip"],
      ["right_shoulder", "right_hip"],
      ["nose", "left_shoulder"],
      ["nose", "right_shoulder"],
    ]

    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)"
    ctx.lineWidth = 2

    for (const [from, to] of connections) {
      const fromKeypoint = pose.keypoints.find((kp) => kp.name === from)
      const toKeypoint = pose.keypoints.find((kp) => kp.name === to)

      if (
        fromKeypoint &&
        toKeypoint &&
        fromKeypoint.score &&
        toKeypoint.score &&
        fromKeypoint.score > 0.3 &&
        toKeypoint.score > 0.3
      ) {
        ctx.beginPath()
        ctx.moveTo(fromKeypoint.x, fromKeypoint.y)
        ctx.lineTo(toKeypoint.x, toKeypoint.y)
        ctx.stroke()
      }
    }

    // Draw keypoints
    for (const keypoint of pose.keypoints) {
      if (keypoint.score && keypoint.score > 0.3) {
        if (keypoint.name === "left_ankle") {
          ctx.fillStyle = "rgba(59, 130, 246, 0.7)" // blue
          ctx.beginPath()
          ctx.arc(keypoint.x, keypoint.y, 8, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = "#3b82f6"
          ctx.lineWidth = 2
          ctx.stroke()
        } else if (keypoint.name === "right_ankle") {
          ctx.fillStyle = "rgba(16, 185, 129, 0.7)" // green
          ctx.beginPath()
          ctx.arc(keypoint.x, keypoint.y, 8, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = "#10b981"
          ctx.lineWidth = 2
          ctx.stroke()
        } else {
          ctx.fillStyle = "rgba(255, 255, 255, 0.7)"
          ctx.beginPath()
          ctx.arc(keypoint.x, keypoint.y, 4, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    // Draw jump height if in air
    if (inAirRef.current && groundLevelRef.current !== null) {
      const currentJumpHeight = avgFootHeight - groundLevelRef.current
      ctx.fillStyle = "rgba(255, 255, 255, 0.8)"
      ctx.font = "16px Arial"
      ctx.fillText(`Height: ${currentJumpHeight.toFixed(1)}px`, width / 2 - 50, 30)
      console.log("DEBUG: Drawing jump height:", currentJumpHeight)
    }
  }

  // Retry camera setup
  const retryCamera = () => {
    console.log("DEBUG: Retrying camera setup")
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setCameraLoading(true)
    setError(null)
    setupCamera()
  }

  return (
    <div className="relative w-full h-full">
      <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
      <canvas
        ref={canvasRef}
        className={`absolute top-0 left-0 w-full h-full ${showTracking ? "opacity-100" : "opacity-0"}`}
      />

      {(cameraLoading || modelLoading) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="text-white text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-white mx-auto mb-2"></div>
            <p>{cameraLoading ? "Initializing camera..." : "Loading AI model..."}</p>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70">
          <div className="text-white text-center p-4 max-w-md">
            <div className="text-red-500 text-5xl mb-2">⚠️</div>
            <h3 className="text-xl font-bold mb-2">Camera Error</h3>
            <p className="mb-4">{error}</p>
            <button
              onClick={retryCamera}
              className="px-4 py-2 bg-primary rounded-md hover:bg-primary/80 transition-colors"
            >
              Retry Camera Access
            </button>
          </div>
        </div>
      )}

      {isProcessing && !error && !cameraLoading && !modelLoading && (
        <div className="absolute top-4 right-4 flex items-center">
          <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse mr-2"></div>
          <span className="text-white font-medium">Processing</span>
        </div>
      )}

      {/* Jump stats overlay */}
      {isProcessing && !error && !cameraLoading && !modelLoading && (
        <div className="absolute bottom-4 left-4 right-4 bg-black/50 p-3 rounded-md text-white text-sm">
          <div className="flex justify-between">
            <span>Jump Count: {jumpCount}</span>
            <span>Max Height: {maxHeight.toFixed(1)}px</span>
          </div>
          <div className="flex justify-between mt-1">
            <span>Last Jump: {lastJumpHeight.toFixed(1)}px</span>
            <span>Flight Time: {flightTime.toFixed(2)}s</span>
          </div>
        </div>
      )}
    </div>
  )
}

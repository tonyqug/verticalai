"use client"

import { useRef, useEffect, useState, useCallback } from "react"
import * as tf from "@tensorflow/tfjs"
import "@tensorflow/tfjs-backend-webgl"
import "@tensorflow/tfjs-backend-wasm"
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
  const [bestFlightTime, setBestFlightTime] = useState(0)
  const [bestFlightJump, setBestFlightJump] = useState(0)
  const [bestMaxHeight, setBestMaxHeight] = useState(0)
  const [bestMaxJump, setBestMaxJump] = useState(0)

  // Refs for tracking and throttling
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<poseDetection.PoseDetector | null>(null)
  const requestRef = useRef<number | null>(null)
  const groundLevelRef = useRef<number | null>(null)
  const inAirRef = useRef<boolean>(false)
  const jumpStartTimeRef = useRef<number | null>(null)
  const feetPositionsRef = useRef<number[]>([])
  const lastTimeRef = useRef<number>(0)
  const lastDrawTimeRef = useRef<number>(0) // For throttling canvas drawing

  // Setup camera
  const setupCamera = useCallback(async () => {
    setCameraLoading(true)
    setError(null)

    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
      const stream = await getBestCameraStream()
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.setAttribute("playsinline", "true")
        videoRef.current.setAttribute("webkit-playsinline", "true")
        videoRef.current.onloadedmetadata = () => {
          videoRef.current
            ?.play()
            .then(() => setCameraLoading(false))
            .catch((e) => {
              console.error("Error playing video:", e)
              setError("Could not play video. Please ensure you've granted camera permissions.")
            })
        }
      }
    } catch (err: any) {
      console.error("Camera error:", err)
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
    try {
      setModelLoading(true)
      await tf.ready()
      const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (isIOS) {
        await tf.setBackend("wasm");
        console.log("Using WASM backend for iOS");
      } else {
        await tf.setBackend("webgl");
        console.log("Using WebGL backend");
      }
      const detector = await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet, {
        modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING,
        enableSmoothing: true,
      })
      detectorRef.current = detector
      setModelLoading(false)
      return detector
    } catch (err) {
      console.error("Error loading pose detection model:", err)
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
    setupCamera()
    setupModel()
    return () => {
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
    setupCamera()
  }, [facingMode, setupCamera])

  // Start/stop processing
  useEffect(() => {
    if (!isRecording || !videoRef.current || error || modelLoading || cameraLoading) {
      setIsProcessing(false)
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current)
        requestRef.current = null
      }
      return
    }
    setIsProcessing(true)
    // Reset tracking data on new recording
    groundLevelRef.current = null
    inAirRef.current = false
    jumpStartTimeRef.current = null
    feetPositionsRef.current = []
    setJumpCount(0)
    setMaxHeight(0)
    setFlightTime(0)
    setLastJumpHeight(0)
    // Note: Best jump stats are NOT reset now so they persist across recordings.
    processVideo()
    return () => {
      setIsProcessing(false)
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current)
        requestRef.current = null
      }
    }
  }, [isRecording, error, modelLoading, cameraLoading])

  // Process video frames
  const processVideo = async () => {
    if (!videoRef.current || !canvasRef.current || !detectorRef.current) return;
    const detector = detectorRef.current;

    const detectPose = async (time: number) => {
      // High-fps calculation throttle (~16ms)
      if (time - lastTimeRef.current < 16) {
        requestRef.current = requestAnimationFrame(detectPose);
        return;
      }
      lastTimeRef.current = time;

      const canvas: any = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        requestRef.current = requestAnimationFrame(detectPose);
        return;
      }

      // Update canvas size if needed
      const videoWidth = videoRef.current.videoWidth || 640;
      const videoHeight = videoRef.current.videoHeight || 480;
      if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
        canvas.width = videoWidth;
        canvas.height = videoHeight;
      }

      // Draw visuals at lower frequency (every ~100ms)
      if (time - lastDrawTimeRef.current >= 100) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        lastDrawTimeRef.current = time;
      }

      try {
        const poses = await detector.estimatePoses(videoRef.current!, {
          flipHorizontal: facingMode === "user",
        });
        if (poses.length > 0) {
          processPose(ctx, poses[0], canvas.width, canvas.height, time);
        }
      } catch (err) {
        console.error("Error processing video frame:", err);
      }

      requestRef.current = requestAnimationFrame(detectPose);
    };

    requestRef.current = requestAnimationFrame(detectPose);
  };

  // Process pose data and update stats
  const processPose = (
    ctx: CanvasRenderingContext2D,
    pose: poseDetection.Pose,
    width: number,
    height: number,
    timestamp: number
  ) => {
    const leftAnkle = pose.keypoints.find((kp) => kp.name === "left_ankle")
    const rightAnkle = pose.keypoints.find((kp) => kp.name === "right_ankle")
    if (!leftAnkle || !rightAnkle) return

    let leftFootHeight, rightFootHeight
    if (leftAnkle.score && rightAnkle.score && leftAnkle.score + rightAnkle.score < 0.6) {
      leftFootHeight = 0
      rightFootHeight = 0
    } else {
      leftFootHeight = height - leftAnkle.y
      rightFootHeight = height - rightAnkle.y
    }
    const avgFootHeight = Math.min(leftFootHeight, rightFootHeight)

    // Update tracking array
    feetPositionsRef.current.push(avgFootHeight)
    if (feetPositionsRef.current.length > 30) feetPositionsRef.current.shift()

    // Determine ground level
    if (groundLevelRef.current === null) {
      groundLevelRef.current = avgFootHeight
    } else if (avgFootHeight < groundLevelRef.current && avgFootHeight > groundLevelRef.current - 100) {
      groundLevelRef.current = avgFootHeight
    }

    // Detect jump events
    const jumpThreshold = 20
    const isInAir = groundLevelRef.current !== null && avgFootHeight > groundLevelRef.current + jumpThreshold

    if (isInAir && !inAirRef.current) {
      inAirRef.current = true
      jumpStartTimeRef.current = timestamp
    } else if (!isInAir && inAirRef.current) {
      inAirRef.current = false
      if (jumpStartTimeRef.current !== null) {
        const jumpFlightTime = (timestamp - jumpStartTimeRef.current) / 1000
        const recentHeights = feetPositionsRef.current.slice(-15)
        const jumpMaxHeight = Math.max(...recentHeights)
        const relativeJumpHeight = groundLevelRef.current !== null ? jumpMaxHeight - groundLevelRef.current : 0

        if (jumpFlightTime > 0.1) {
          // Use functional update to ensure correct jump numbering
          setJumpCount(prev => {
            const newJumpCount = prev + 1
            setFlightTime(jumpFlightTime)
            setLastJumpHeight(relativeJumpHeight)
            setMaxHeight(prevMax => Math.max(prevMax, relativeJumpHeight))
            setBestFlightTime(prevBestFlightTime => {
              if (jumpFlightTime > prevBestFlightTime) {
                setBestFlightJump(newJumpCount)
                return jumpFlightTime
              }
              return prevBestFlightTime
            })
            setBestMaxHeight(prevBestMaxHeight => {
              if (relativeJumpHeight > prevBestMaxHeight) {
                setBestMaxJump(newJumpCount)
                return relativeJumpHeight
              }
              return prevBestMaxHeight
            })
            return newJumpCount
          })
        }
      }
    }

    // Always update vertical calculation
    onFeetHeightUpdate(leftFootHeight, rightFootHeight)

    // Draw visualization only on frames that update visuals
    if (timestamp - lastDrawTimeRef.current < 100) return
    drawVisualization(ctx, pose, width, height, avgFootHeight)
  }

  // Draw tracking visualization
  const drawVisualization = (
    ctx: CanvasRenderingContext2D,
    pose: poseDetection.Pose,
    width: number,
    height: number,
    avgFootHeight: number
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
      ctx.fillStyle = "rgba(255, 255, 255, 0.7)"
      ctx.font = "12px Arial"
      ctx.fillText("Ground Level", 10, height - groundLevelRef.current - 5)
    }

    // Draw skeleton connections
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
          ctx.fillStyle = "rgba(59, 130, 246, 0.7)"
          ctx.beginPath()
          ctx.arc(keypoint.x, keypoint.y, 8, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = "#3b82f6"
          ctx.lineWidth = 2
          ctx.stroke()
        } else if (keypoint.name === "right_ankle") {
          ctx.fillStyle = "rgba(16, 185, 129, 0.7)"
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
    // Draw jump height overlay if in air
    if (inAirRef.current && groundLevelRef.current !== null) {
      const currentJumpHeight = avgFootHeight - groundLevelRef.current
      ctx.fillStyle = "rgba(255, 255, 255, 0.8)"
      ctx.font = "16px Arial"
      ctx.fillText(`Height: ${currentJumpHeight.toFixed(1)}px`, width / 2 - 50, 30)
    }
  }

  // Retry camera setup
  const retryCamera = () => {
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
      <canvas ref={canvasRef} className={`absolute top-0 left-0 w-full h-full ${showTracking ? "opacity-100" : "opacity-0"}`} />

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
            <button onClick={retryCamera} className="px-4 py-2 bg-primary rounded-md hover:bg-primary/80 transition-colors">
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
          <div className="flex justify-between mt-1">
            <span>Best Flight Time: {bestFlightTime.toFixed(2)}s (Jump #{bestFlightJump})</span>
            <span>Best Max Height: {bestMaxHeight.toFixed(1)}px (Jump #{bestMaxJump})</span>
          </div>
        </div>
      )}
    </div>
  )
}

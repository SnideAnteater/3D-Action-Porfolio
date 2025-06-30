"use client";

import { act, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { FBXLoader, EXRLoader } from "three-stdlib";

export default function GameScene() {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const playerRef = useRef<THREE.Object3D | null>(null);
  const keysRef = useRef<{ [key: string]: boolean }>({});
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<{ [key: string]: THREE.AnimationAction }>({});
  const currentActionRef = useRef<string>("idle");
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());
  const isAttackingRef = useRef<boolean>(false);
  const zombieRef = useRef<THREE.Group | null>(null);
  const zombieMixerRef = useRef<THREE.AnimationMixer | null>(null);
  const zombieActionsRef = useRef<{ [key: string]: THREE.AnimationAction }>({});
  const zombieStateRef = useRef<string>("alive"); // "alive" or "dead"
  const glowingOrbRef = useRef<THREE.Mesh | null>(null);
  const treesRef = useRef<THREE.Group[]>([]);

  useEffect(() => {
    if (!mountRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Load skybox texture with reduced brightness and orange tint
    const exrLoader = new EXRLoader();
    exrLoader.load(
      "/assets/puresky_skybox.exr",
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;

        // Create a tone mapping and color adjustment for the skybox
        const pmremGenerator = new THREE.PMREMGenerator(renderer);
        const envMap = pmremGenerator.fromEquirectangular(texture).texture;

        // Apply the processed environment map
        scene.background = envMap;
        scene.environment = envMap;

        // Reduce environment intensity and add orange tint
        scene.backgroundIntensity = 0.3; // Reduce brightness
        scene.environmentIntensity = 0.4; // Reduce environment lighting

        pmremGenerator.dispose();
        console.log("Skybox loaded successfully with orange tint");
      },
      undefined,
      (error) => {
        console.error("Error loading skybox:", error);
        // Fallback to dark orange background
        scene.background = new THREE.Color(0.15, 0.08, 0.04);
      }
    );

    // Camera setup (third-person view)
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    cameraRef.current = camera;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;
    mountRef.current.appendChild(renderer.domElement);

    // Lighting setup - darker atmosphere with orange tint
    const ambientLight = new THREE.AmbientLight(0x4a3020, 0.3); // Dark orange ambient
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffa366, 0.8); // Orange directional light
    directionalLight.position.set(10, 10, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    scene.add(directionalLight);

    // Add subtle orange fill light for atmosphere
    const fillLight = new THREE.DirectionalLight(0xff8040, 0.2); // Warm orange fill
    fillLight.position.set(-5, 5, -5);
    scene.add(fillLight);

    // Create textured ground with forestground texture (darker with orange tint)
    const textureLoader = new THREE.TextureLoader();
    const groundTexture = textureLoader.load("/assets/forestground_diff.jpg");

    // Configure texture properties for proper tiling
    groundTexture.wrapS = THREE.RepeatWrapping;
    groundTexture.wrapT = THREE.RepeatWrapping;
    groundTexture.repeat.set(8, 8); // Tile the texture 8x8 times across the ground

    const groundGeometry = new THREE.PlaneGeometry(200, 200);
    const groundMaterial = new THREE.MeshLambertMaterial({
      map: groundTexture,
      color: new THREE.Color(0.4, 0.25, 0.15), // Dark orange tint (reduces brightness and adds warmth)
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Animation system
    const setupAnimations = (
      fbx: THREE.Group,
      animations: THREE.AnimationClip[]
    ) => {
      const mixer = new THREE.AnimationMixer(fbx);
      mixerRef.current = mixer;

      const actions: { [key: string]: THREE.AnimationAction } = {};
      console.log(actions);

      animations.forEach((clip) => {
        const action = mixer.clipAction(clip);
        actions[clip.name] = action;
      });

      console.log(animations);

      actionsRef.current = actions;

      // Start with idle animation
      if (actions.idle) {
        actions.idle.play();
        currentActionRef.current = "idle";
      }

      console.log("Available animations:", Object.keys(actions));
    };

    const playAnimation = (animationName: string, loop: boolean = true) => {
      const actions = actionsRef.current;
      const currentAction = currentActionRef.current;

      if (actions[animationName] && currentAction !== animationName) {
        // Fade out current animation
        if (actions[currentAction]) {
          actions[currentAction].fadeOut(0.2);
        }

        // Fade in new animation
        actions[animationName].reset().fadeIn(0.2);
        actions[animationName].setLoop(
          loop ? THREE.LoopRepeat : THREE.LoopOnce,
          Infinity
        );
        actions[animationName].play();

        currentActionRef.current = animationName;
      }
    };

    // Load FBX character model and animations
    const fbxLoader = new FBXLoader();
    const playerGroup = new THREE.Group();
    let loadedAnimations = 0;
    const totalAnimations = 6;
    const animationClips: THREE.AnimationClip[] = [];

    // Helper function to rename animation clips
    const renameAnimationClip = (
      clip: THREE.AnimationClip,
      newName: string
    ) => {
      const renamedClip = clip.clone();
      renamedClip.name = newName;
      return renamedClip;
    };

    // Animation loading helper
    const loadAnimation = (
      filePath: string,
      animationName: string,
      isBaseModel: boolean = false
    ) => {
      fbxLoader.load(
        filePath,
        (fbx) => {
          if (isBaseModel) {
            // Scale the model
            fbx.scale.setScalar(0.01);

            // Enable shadows
            fbx.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.castShadow = true;
                child.receiveShadow = true;
              }
            });

            // Rotate character to face away from camera (towards negative Z)
            fbx.rotation.y = Math.PI;

            playerGroup.add(fbx);
          }

          // Store animation with proper name
          if (fbx.animations.length > 0) {
            const renamedClip = renameAnimationClip(
              fbx.animations[0],
              animationName
            );
            animationClips.push(renamedClip);
          }

          loadedAnimations++;
          if (loadedAnimations === totalAnimations) {
            setupAnimations(
              isBaseModel ? fbx : (playerGroup.children[0] as THREE.Group),
              animationClips
            );
          }

          console.log(`${animationName} animation loaded`);
        },
        undefined,
        (error) =>
          console.error(`Error loading ${animationName} animation:`, error)
      );
    };

    // Load all animations
    loadAnimation("/assets/S&SIdle.fbx", "idle", true); // Base model
    loadAnimation("/assets/S&SAttack.fbx", "attack");
    loadAnimation("/assets/S&SWalkForward.fbx", "walkForward");
    loadAnimation("/assets/S&SWalkBack.fbx", "walkBack");
    loadAnimation("/assets/S&SStrafeLeft.fbx", "strafeLeft");
    loadAnimation("/assets/S&SStrafeRight.fbx", "strafeRight");

    // Load zombie model and animations
    const loadZombie = () => {
      let zombieModel: THREE.Group;
      let zombieMixer: THREE.AnimationMixer;
      const zombieAnimations: THREE.AnimationClip[] = [];
      let loadedCount = 0;
      const totalZombieAnimations = 2;

      // Helper function to setup zombie animations
      const setupZombieAnimations = () => {
        if (loadedCount === totalZombieAnimations && zombieModel) {
          zombieMixer = new THREE.AnimationMixer(zombieModel);
          zombieMixerRef.current = zombieMixer;

          const actions: { [key: string]: THREE.AnimationAction } = {};

          zombieAnimations.forEach((clip) => {
            const action = zombieMixer.clipAction(clip);
            actions[clip.name] = action;
          });

          zombieActionsRef.current = actions;

          // Start with idle animation
          if (actions.zombieIdle) {
            actions.zombieIdle.play();
          }

          console.log("Zombie animations setup:", Object.keys(actions));
        }
      };

      // Load zombie idle model (base)
      fbxLoader.load(
        "/assets/ZombieIdle.fbx",
        (fbx) => {
          // Scale and position the zombie
          fbx.scale.setScalar(0.008);
          fbx.position.set(-5, 0, -5);

          // Enable shadows for zombie
          fbx.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          // Store idle animation
          if (fbx.animations.length > 0) {
            const idleClip = fbx.animations[0].clone();
            idleClip.name = "zombieIdle";
            zombieAnimations.push(idleClip);
          }

          scene.add(fbx);
          zombieRef.current = fbx;
          zombieModel = fbx;
          loadedCount++;
          setupZombieAnimations();

          console.log("Zombie model loaded");
        },
        undefined,
        (error) => console.error("Error loading zombie model:", error)
      );

      // Load zombie death animation
      fbxLoader.load(
        "/assets/ZombieDeath.fbx",
        (fbx) => {
          // Store death animation
          if (fbx.animations.length > 0) {
            const deathClip = fbx.animations[0].clone();
            deathClip.name = "zombieDeath";
            zombieAnimations.push(deathClip);
          }

          loadedCount++;
          setupZombieAnimations();

          console.log("Zombie death animation loaded");
        },
        undefined,
        (error) => console.error("Error loading zombie death animation:", error)
      );
    };

    loadZombie();

    // Load and populate trees in the scene
    const loadTrees = () => {
      const textureLoader = new THREE.TextureLoader();
      
      // Load oak trees
      const loadOakTrees = () => {
        fbxLoader.load(
          '/assets/oakTrees/source/oaktrees.fbx',
          (fbx) => {
            // Load textures for oak trees
            const barkTexture = textureLoader.load('/assets/oakTrees/textures/bark1.png');
            const barkNormal = textureLoader.load('/assets/oakTrees/textures/bark1Normal.png');
            const barkRoughness = textureLoader.load('/assets/oakTrees/textures/bark1Roughness.png');
            const branchTexture = textureLoader.load('/assets/oakTrees/textures/oakbranchcolor.png');
            const branchNormal = textureLoader.load('/assets/oakTrees/textures/oakbranchNormal.png');
            const branchRoughness = textureLoader.load('/assets/oakTrees/textures/oakbranchRoughness.png');

            // Apply textures to oak tree materials
            fbx.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                
                // Create material based on mesh name or material
                if (child.material) {
                  const material = new THREE.MeshStandardMaterial({
                    map: child.name.toLowerCase().includes('branch') ? branchTexture : barkTexture,
                    normalMap: child.name.toLowerCase().includes('branch') ? branchNormal : barkNormal,
                    roughnessMap: child.name.toLowerCase().includes('branch') ? branchRoughness : barkRoughness,
                    color: 0x8B7D6B // Darker tint for atmosphere
                  });
                  child.material = material;
                }
              }
            });

            // Create multiple oak tree instances
            for (let i = 0; i < 8; i++) {
              const oakClone = fbx.clone();
              oakClone.scale.setScalar(0.05 + Math.random() * 0.03); // Random scale
              
              // Random position around the edges of the scene
              const angle = (i / 8) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
              const distance = 40 + Math.random() * 40;
              oakClone.position.set(
                Math.cos(angle) * distance,
                0,
                Math.sin(angle) * distance
              );
              
              oakClone.rotation.y = Math.random() * Math.PI * 2; // Random rotation
              
              scene.add(oakClone);
              treesRef.current.push(oakClone);
            }
            
            console.log('Oak trees loaded and placed');
          },
          undefined,
          (error) => console.error('Error loading oak trees:', error)
        );
      };

      // Load pine trees
      const loadPineTrees = () => {
        fbxLoader.load(
          '/assets/pine-tree/source/Tree.fbx',
          (fbx) => {
            // Load textures for pine trees
            const leavesTexture = textureLoader.load('/assets/pine-tree/textures/Leavs_basecolor_.tga.png');
            const leavesOpacity = textureLoader.load('/assets/pine-tree/textures/Leavs_Opacity.png');
            const trunkTexture = textureLoader.load('/assets/pine-tree/textures/Trank_basecolor.tga.png');
            const trunkNormal = textureLoader.load('/assets/pine-tree/textures/Trank_normal.tga.png');

            // Apply textures to pine tree materials
            fbx.traverse((child) => {
              if (child instanceof THREE.Mesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                
                if (child.material) {
                  let material;
                  if (child.name.toLowerCase().includes('lea') || child.name.toLowerCase().includes('branch')) {
                    // Leaves material
                    material = new THREE.MeshStandardMaterial({
                      map: leavesTexture,
                      alphaMap: leavesOpacity,
                      transparent: true,
                      alphaTest: 0.5,
                      color: 0x4a5d3a // Darker green tint
                    });
                  } else {
                    // Trunk material
                    material = new THREE.MeshStandardMaterial({
                      map: trunkTexture,
                      normalMap: trunkNormal,
                      color: 0x6B5B4F // Darker brown tint
                    });
                  }
                  child.material = material;
                }
              }
            });

            // Create multiple pine tree instances
            for (let i = 0; i < 12; i++) {
              const pineClone = fbx.clone();
              pineClone.scale.setScalar(0.03 + Math.random() * 0.02); // Random scale
              
              // Random position scattered around the scene
              const angle = Math.random() * Math.PI * 2;
              const distance = 25 + Math.random() * 60;
              pineClone.position.set(
                Math.cos(angle) * distance,
                0,
                Math.sin(angle) * distance
              );
              
              pineClone.rotation.y = Math.random() * Math.PI * 2; // Random rotation
              
              scene.add(pineClone);
              treesRef.current.push(pineClone);
            }
            
            console.log('Pine trees loaded and placed');
          },
          undefined,
          (error) => console.error('Error loading pine trees:', error)
        );
      };

      loadOakTrees();
      loadPineTrees();
    };

    loadTrees();

    playerGroup.position.set(0, 0, 0);
    scene.add(playerGroup);
    playerRef.current = playerGroup;

    // Hit detection function
    const checkHit = () => {
      if (
        !playerRef.current ||
        !zombieRef.current ||
        zombieStateRef.current === "dead"
      )
        return false;

      const playerPosition = playerRef.current.position;
      const zombiePosition = zombieRef.current.position;

      // Calculate distance between player and zombie
      const distance = playerPosition.distanceTo(zombiePosition);

      // Hit range (adjust this value to change attack range)
      const hitRange = 3.0;

      return distance <= hitRange;
    };

    // Function to create glowing orb
    const createGlowingOrb = (position: THREE.Vector3) => {
      // Create sphere geometry
      const orbGeometry = new THREE.SphereGeometry(0.1, 16, 16);

      // Create glowing material
      const orbMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff, // Golden color
        emissive: 0xffaa00, // Orange emissive glow
        emissiveIntensity: 0.5,
        transparent: true,
        opacity: 0.8,
        metalness: 0.1,
        roughness: 0.2,
      });

      // Create the orb mesh
      const orb = new THREE.Mesh(orbGeometry, orbMaterial);
      orb.position.copy(position);
      orb.position.y += 1; // Float above ground

      // Add to scene
      scene.add(orb);
      glowingOrbRef.current = orb;

      console.log("Glowing orb created at zombie location!");
    };

    // Function to play zombie death animation
    const killZombie = () => {
      if (zombieStateRef.current === "dead") return;

      zombieStateRef.current = "dead";
      const actions = zombieActionsRef.current;

      if (actions.zombieIdle) {
        actions.zombieIdle.fadeOut(0.2);
      }

      if (actions.zombieDeath) {
        actions.zombieDeath.reset().fadeIn(0.2);
        actions.zombieDeath.setLoop(THREE.LoopOnce, 1);
        actions.zombieDeath.clampWhenFinished = true; // Stay in final pose
        actions.zombieDeath.play();
      }

      // Create glowing orb at zombie's position after a delay
      if (zombieRef.current) {
        setTimeout(() => {
          createGlowingOrb(zombieRef.current!.position.clone());
        }, 2000); // Wait 2 seconds for death animation to play
      }

      console.log("Zombie killed!");
    };

    // Position camera behind and above player
    camera.position.set(0, 3, 5);
    camera.lookAt(playerGroup.position);

    // Input controls
    const handleKeyDown = (event: KeyboardEvent) => {
      keysRef.current[event.code] = true;
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      keysRef.current[event.code] = false;
    };

    const handleMouseClick = (event: MouseEvent) => {
      if (event.button === 0 && !isAttackingRef.current) {
        // Left click - only if not already attacking
        isAttackingRef.current = true;
        playAnimation("attack", false);

        // Check for hit during attack animation (slight delay for realism)
        setTimeout(() => {
          if (checkHit()) {
            console.log("Hit Registered");
            killZombie(); // Trigger death animation
          }
        }, 300); // Check hit 300ms into attack animation

        // Return to idle after attack animation
        setTimeout(() => {
          isAttackingRef.current = false;

          const isMoving =
            keysRef.current["KeyW"] ||
            keysRef.current["KeyS"] ||
            keysRef.current["KeyA"] ||
            keysRef.current["KeyD"] ||
            keysRef.current["ArrowUp"] ||
            keysRef.current["ArrowDown"] ||
            keysRef.current["ArrowLeft"] ||
            keysRef.current["ArrowRight"];

          if (isMoving) {
            // Determine which movement animation to return to
            if (keysRef.current["KeyW"] || keysRef.current["ArrowUp"]) {
              playAnimation("walkForward");
            } else if (
              keysRef.current["KeyS"] ||
              keysRef.current["ArrowDown"]
            ) {
              playAnimation("walkBack");
            } else if (
              keysRef.current["KeyA"] ||
              keysRef.current["ArrowLeft"]
            ) {
              playAnimation("strafeLeft");
            } else if (
              keysRef.current["KeyD"] ||
              keysRef.current["ArrowRight"]
            ) {
              playAnimation("strafeRight");
            } else {
              playAnimation("idle");
            }
          } else {
            playAnimation("idle");
          }
        }, 1000); // Adjust timing based on attack animation length
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("mousedown", handleMouseClick);

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);

      // Update animation mixers
      const delta = clockRef.current.getDelta();
      if (mixerRef.current) {
        mixerRef.current.update(delta);
      }
      if (zombieMixerRef.current) {
        zombieMixerRef.current.update(delta);
      }

      // Animate glowing orb (floating motion)
      if (glowingOrbRef.current) {
        const time = Date.now() * 0.003;
        glowingOrbRef.current.position.y += Math.sin(time) * 0.002; // Gentle floating
        glowingOrbRef.current.rotation.y += 0.01; // Slow rotation

        // Pulsing glow effect
        const pulseFactor = (Math.sin(time * 2) + 1) * 0.5; // 0 to 1
        const material = glowingOrbRef.current
          .material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = 0.3 + pulseFactor * 0.4; // Pulse between 0.3 and 0.7
      }

      if (playerRef.current) {
        const player = playerRef.current;
        const moveSpeed = 0.1;
        let moved = false;

        // Player movement with directional animations (only if not attacking)
        const currentAction = currentActionRef.current;
        let currentMovement = "";

        if (!isAttackingRef.current) {
          // Only allow movement if not attacking
          if (keysRef.current["KeyW"] || keysRef.current["ArrowUp"]) {
            player.position.z -= moveSpeed;
            moved = true;
            currentMovement = "walkForward";
          }
          if (keysRef.current["KeyS"] || keysRef.current["ArrowDown"]) {
            player.position.z += moveSpeed;
            moved = true;
            currentMovement = "walkBack";
          }
          if (keysRef.current["KeyA"] || keysRef.current["ArrowLeft"]) {
            player.position.x -= moveSpeed;
            moved = true;
            currentMovement = "strafeLeft";
          }
          if (keysRef.current["KeyD"] || keysRef.current["ArrowRight"]) {
            player.position.x += moveSpeed;
            moved = true;
            currentMovement = "strafeRight";
          }
        }

        // Animation state management with directional movement
        if (!isAttackingRef.current) {
          // Only change animations if not attacking
          if (moved && currentAction !== "attack") {
            // Only switch animation if not attacking and animation is different
            if (currentAction !== currentMovement) {
              playAnimation(currentMovement);
            }
          } else if (!moved && currentAction !== "attack") {
            // Only switch to idle if not attacking
            if (currentAction !== "idle") {
              playAnimation("idle");
            }
          }
        }

        // Update camera to follow player (always, not just when moving)
        if (cameraRef.current) {
          const cameraOffset = new THREE.Vector3(0, 2, 1.5);
          const idealPosition = new THREE.Vector3()
            .copy(player.position)
            .add(cameraOffset);

          // Smooth camera movement
          cameraRef.current.position.lerp(idealPosition, 1);
        }
      }

      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };

    animate();

    // Handle window resize
    const handleResize = () => {
      if (cameraRef.current && rendererRef.current) {
        cameraRef.current.aspect = window.innerWidth / window.innerHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(window.innerWidth, window.innerHeight);
      }
    };

    window.addEventListener("resize", handleResize);

    // Cleanup
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("mousedown", handleMouseClick);
      window.removeEventListener("resize", handleResize);

      if (mountRef.current && rendererRef.current) {
        mountRef.current.removeChild(rendererRef.current.domElement);
      }

      if (rendererRef.current) {
        rendererRef.current.dispose();
      }

      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
      }

      if (zombieMixerRef.current) {
        zombieMixerRef.current.stopAllAction();
      }
    };
  }, []);

  return (
    <div className="relative w-full h-screen">
      <div ref={mountRef} className="w-full h-full" />
      <div className="absolute top-4 left-4 text-white bg-black/50 p-3 rounded">
        <h3 className="text-lg font-bold mb-2">Controls:</h3>
        <p>WASD or Arrow Keys - Move</p>
        <p>Left Click - Attack</p>
        <p className="text-sm text-orange-300 mt-1">
          Get close to zombie and attack to register hits!
        </p>
      </div>
    </div>
  );
}
